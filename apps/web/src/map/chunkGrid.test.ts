import { describe, expect, it } from "vitest";
import type { Vec3 } from "@/common/geometry";
import {
  aabbIntersectsFrustum,
  buildChunkRecords,
  distanceSqToPointAabb,
  distanceToChunk,
  lodLevelForDistance,
  selectChunks,
  sortByDistance,
  type ChunkInfo,
  type FrustumPlanes,
} from "./chunkGrid";

function info(
  id: string,
  boundsMin: [number, number, number],
  boundsMax: [number, number, number],
  extra?: { instances?: number; lods?: { level: number; file: string }[] },
): ChunkInfo {
  return {
    id,
    file: `chunks/c_${id}_l0.dmap`,
    instances: extra?.instances ?? 10,
    boundsMin,
    boundsMax,
    ...(extra?.lods !== undefined ? { lods: extra.lods } : {}),
  };
}

/** 三层容器表（v4 分层包形状）。 */
function tieredLods(id: string): { level: number; file: string }[] {
  return [0, 1, 2].map((level) => ({ level, file: `chunks/c_${id}_l${level}.dmap` }));
}

/** 构造「朝向锥」简化视锥：近面在 origin、远面 farDist、半角 cosHalf。 */
function coneFrustum(
  origin: Vec3,
  dirX: number,
  dirZ: number,
  cosHalf: number,
  farDist = 400,
): FrustumPlanes {
  // 平面约定：n·p + d ≥ 0 内侧。d = −n·origin。
  const planes: [number, number, number, number][] = [
    [dirX, 0, dirZ, -(dirX * origin.x + dirZ * origin.z)],
    [-dirX, 0, -dirZ, dirX * origin.x + dirZ * origin.z + farDist],
  ];
  // 以 cosHalf 构造左右侧面（把朝向锥压成四棱锥的两面）
  const sideX = -dirZ;
  const sideZ = dirX;
  const s = Math.sqrt(1 - cosHalf * cosHalf) / Math.max(cosHalf, 1e-6);
  planes.push([dirX + sideX * s, 0, dirZ + sideZ * s, -(dirX * origin.x + dirZ * origin.z)]);
  planes.push([dirX - sideX * s, 0, dirZ - sideZ * s, -(dirX * origin.x + dirZ * origin.z)]);
  return planes;
}

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

describe("chunk 空间分桶", () => {
  it("buildChunkRecords 计算中心与半径", () => {
    const records = buildChunkRecords([info("a", [-100, -10, -100], [100, 10, 100])]);
    expect(records[0].center).toEqual({ x: 0, y: 0, z: 0 });
    expect(records[0].radius).toBeCloseTo(Math.sqrt(200 * 200 + 20 * 20 + 200 * 200) / 2);
  });

  it("点到 AABB 距离：盒内为 0，盒外按最近角", () => {
    const min: Vec3 = { x: 10, y: 10, z: 10 };
    const max: Vec3 = { x: 20, y: 20, z: 20 };
    expect(distanceSqToPointAabb({ x: 15, y: 15, z: 15 }, min, max)).toBe(0);
    expect(distanceSqToPointAabb({ x: 25, y: 15, z: 15 }, min, max)).toBe(25);
    expect(distanceSqToPointAabb({ x: 0, y: 0, z: 0 }, min, max)).toBe(300);
  });

  it("视锥相交：包围盒在平面内侧保留、外侧剔除", () => {
    const min: Vec3 = { x: 45, y: -5, z: -5 };
    const max: Vec3 = { x: 55, y: 5, z: 5 };
    const forward = coneFrustum(ORIGIN, 1, 0, 0.5);
    expect(aabbIntersectsFrustum(min, max, forward)).toBe(true);
    const behind: Vec3 = { x: -55, y: -5, z: -5 };
    const behindMax: Vec3 = { x: -45, y: 5, z: 5 };
    expect(aabbIntersectsFrustum(behind, behindMax, forward)).toBe(false);
  });

  it("视锥相交：包围盒跨界（部分在内）保留", () => {
    // 盒体跨 x=0 平面（背面约束被 400 距离放宽），应保留
    const min: Vec3 = { x: -5, y: -5, z: -5 };
    const max: Vec3 = { x: 5, y: 5, z: 5 };
    const forward = coneFrustum(ORIGIN, 1, 0, 0.9);
    expect(aabbIntersectsFrustum(min, max, forward)).toBe(true);
  });

  it("selectChunks：半径内加载、已加载滞留带内保留、滞留带外卸载", () => {
    const records = buildChunkRecords([
      info("near", [10, 0, 0], [20, 1, 10]),
      info("mid", [150, 0, 0], [160, 1, 10]),
      info("far", [600, 0, 0], [610, 1, 10]),
    ]);
    const center: Vec3 = { x: 0, y: 0, z: 0 };

    // 半径 100：near 加载，mid/far 不加载
    const first = selectChunks({ chunks: records, center, radius: 100 });
    expect(first.toLoad.map((c) => c.id)).toEqual(["near"]);
    expect(first.toUnload).toEqual([]);

    // 半径 100 + 已加载 mid（在 150 处）：迟滞默认 25 → 125 < 150 → 卸载
    const loaded = new Set(["mid"]);
    const shrink = selectChunks({ chunks: records, center, radius: 100, loadedIds: loaded });
    expect(shrink.toUnload).toEqual(["mid"]);

    // 半径 80 + 已加载 mid：80+25=105 < 150 仍卸载；radius 130 时 mid 保留（near 则为待加载）
    const keep = selectChunks({ chunks: records, center, radius: 130, loadedIds: loaded });
    expect(keep.toUnload).toEqual([]);
    expect(keep.toLoad.map((c) => c.id)).toEqual(["near"]);

    // 视锥剔除：far 在半径外且不在视锥内，即便已加载（迟滞放大后）也卸载
    const loadedFar = new Set(["far"]);
    const culled = selectChunks({
      chunks: records,
      center,
      radius: 700,
      hysteresis: 50,
      planes: coneFrustum(ORIGIN, 1, 0, 0.99, 800),
      loadedIds: loadedFar,
    });
    // far 在 +x 方向 600m、视锥朝 +x：视锥内，保留
    expect(culled.toUnload).toEqual([]);
    const culledBack = selectChunks({
      chunks: records,
      center,
      radius: 700,
      hysteresis: 50,
      planes: coneFrustum(ORIGIN, -1, 0, 0.99, 800),
      loadedIds: loadedFar,
    });
    expect(culledBack.toUnload).toEqual(["far"]);
  });

  it("selectChunks：planes 缺省时纯半径判定（保底全量加载路径）", () => {
    const records = buildChunkRecords([info("a", [90, 0, 0], [95, 1, 5])]);
    const result = selectChunks({
      chunks: records,
      center: { x: 0, y: 0, z: 0 },
      radius: 100,
    });
    expect(result.toLoad.map((c) => c.id)).toEqual(["a"]);
  });

  it("sortByDistance 按 AABB 最近点升序", () => {
    const records = buildChunkRecords([
      info("c", [300, 0, 0], [310, 1, 5]),
      info("a", [10, 0, 0], [20, 1, 5]),
      info("b", [100, 0, 0], [110, 1, 5]),
    ]);
    const sorted = sortByDistance(records, { x: 0, y: 0, z: 0 });
    expect(sorted.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
});

describe("LOD 分带（lodLevelForDistance / selectChunks.desiredLevels）", () => {
  const bands = { thresholds: [300, 600] as const, hysteresis: 60 };

  it("纯距离分带：近=0 中=1 远=2（无当前层时）", () => {
    expect(lodLevelForDistance(0, bands)).toBe(0);
    expect(lodLevelForDistance(299.9, bands)).toBe(0);
    expect(lodLevelForDistance(300, bands)).toBe(1);
    expect(lodLevelForDistance(599.9, bands)).toBe(1);
    expect(lodLevelForDistance(600, bands)).toBe(2);
    expect(lodLevelForDistance(5000, bands)).toBe(2);
  });

  it("迟滞带：边界 ± margin 内维持当前层，越过后才换层", () => {
    // 当前 0 层（近带）：距离进入 [300, 360) 迟滞区间仍维持 0，≥360 降为 1。
    expect(lodLevelForDistance(330, bands, 0)).toBe(0);
    expect(lodLevelForDistance(359.9, bands, 0)).toBe(0);
    expect(lodLevelForDistance(360, bands, 0)).toBe(1);
    // 当前 1 层：距离回到 (240, 300] 迟滞区间仍维持 1，<240 升为 0（240 本身仍维持）。
    expect(lodLevelForDistance(250, bands, 1)).toBe(1);
    expect(lodLevelForDistance(240.1, bands, 1)).toBe(1);
    expect(lodLevelForDistance(240, bands, 1)).toBe(1);
    expect(lodLevelForDistance(239.9, bands, 1)).toBe(0);
    // 当前 1 层向 2 层：[600, 660) 迟滞区间维持 1，≥660 降为 2。
    expect(lodLevelForDistance(650, bands, 1)).toBe(1);
    expect(lodLevelForDistance(660, bands, 1)).toBe(2);
    // 当前 2 层向 1 层：(540, 600] 维持 2，<540 升为 1（540 本身仍维持）。
    expect(lodLevelForDistance(550, bands, 2)).toBe(2);
    expect(lodLevelForDistance(540, bands, 2)).toBe(2);
    expect(lodLevelForDistance(539.9, bands, 2)).toBe(1);
    // 跨带跃迁：远带瞬间拉近（d < t0 − m）直接升到 0。
    expect(lodLevelForDistance(200, bands, 2)).toBe(0);
  });

  it("迟滞往返不抖动：边界附近来回移动时层级稳定", () => {
    let level = lodLevelForDistance(310, bands); // 首载 → 1
    expect(level).toBe(1);
    // 在迟滞区间内来回（1 层 ↔ 边界两侧小幅往返）恒为 1。
    for (const d of [340, 320, 350, 290, 330, 260, 245, 300]) {
      level = lodLevelForDistance(d, bands, level);
      expect(level).toBe(1);
    }
    // 明确越过下界（240）后升 0，再小幅回弹（≥240）不降回 1。
    level = lodLevelForDistance(235, bands, level);
    expect(level).toBe(0);
    level = lodLevelForDistance(280, bands, level);
    expect(level).toBe(0);
  });

  it("selectChunks：保留集按中心距离给期望层级（LOD 缺省恒 0）", () => {
    const records = buildChunkRecords([
      info("near", [10, 0, 0], [20, 1, 10], { instances: 3 }),
      info("mid", [290, 0, 0], [300, 1, 10], { instances: 5 }), // 中心 295 → 层 0
      info("far", [700, 0, 0], [710, 1, 10], { instances: 7 }), // 中心 705 → 层 2
    ]);
    const center: Vec3 = { x: 0, y: 0, z: 0 };

    // 不传 lod：保留集期望层级恒 0（单层包等价行为）。
    const plain = selectChunks({ chunks: records, center, radius: 800 });
    expect(plain.desiredLevels.get("near")).toBe(0);
    expect(plain.desiredLevels.get("mid")).toBe(0);
    expect(plain.desiredLevels.get("far")).toBe(0);
    expect(plain.toUnload).toEqual([]);

    const banded = selectChunks({ chunks: records, center, radius: 800, lod: bands });
    expect(banded.desiredLevels.get("near")).toBe(0);
    expect(banded.desiredLevels.get("mid")).toBe(0); // 中心 295 < 300
    expect(banded.desiredLevels.get("far")).toBe(2);

    // 已挂载 1 层的 mid（中心 295，处于升层迟滞区间 [240, 300)）：维持 1，
    // 不因短暂跨回近带边界而立即升 0。
    const hysteresisKeep = selectChunks({
      chunks: records,
      center,
      radius: 800,
      lod: bands,
      currentLevels: new Map([
        ["mid", 1],
        ["far", 1],
      ]),
    });
    expect(hysteresisKeep.desiredLevels.get("mid")).toBe(1);
    // far 中心 705 ≥ 600+60：越过降层迟滞，期望降到 2。
    expect(hysteresisKeep.desiredLevels.get("far")).toBe(2);

    // 半径外/视锥外的 chunk 不进保留集（无期望层级）。
    const culled = selectChunks({ chunks: records, center, radius: 50, lod: bands });
    expect(culled.desiredLevels.has("mid")).toBe(false);
    expect(culled.desiredLevels.has("far")).toBe(false);
    expect(culled.toLoad.map((chunk) => chunk.id)).toEqual(["near"]);
  });

  it("buildChunkRecords：分层表推导 hasLodTiers；单层包恒 false", () => {
    const records = buildChunkRecords([
      info("tiered", [0, 0, 0], [10, 1, 10], { lods: tieredLods("tiered") }),
      info("single", [100, 0, 0], [110, 1, 10]),
      info("odd", [200, 0, 0], [210, 1, 10], { lods: [{ level: 0, file: "chunks/c_odd.dmap" }] }),
    ]);
    expect(records[0]?.hasLodTiers).toBe(true);
    expect(records[1]?.hasLodTiers).toBe(false);
    expect(records[2]?.hasLodTiers).toBe(false); // 表内只有 1 层 = 不可切换
    expect(records[0]?.lods).toHaveLength(3);
  });

  it("distanceToChunk：中心距（分带口径，区别于半径判定的最近点距离）", () => {
    const records = buildChunkRecords([info("a", [10, 0, 0], [20, 1, 10])]);
    // 中心 (15, 0.5, 5)：原点距离 √(15² + 0.5² + 5²)。
    expect(distanceToChunk({ x: 0, y: 0, z: 0 }, records[0]!)).toBeCloseTo(
      Math.sqrt(15 * 15 + 0.5 * 0.5 + 5 * 5),
    );
    // 检测点 (15, 0, 5)：仅剩 y 偏移 0.5（AABB 最近点口径此时为 0）。
    expect(distanceToChunk({ x: 15, y: 0, z: 5 }, records[0]!)).toBeCloseTo(0.5);
  });
});

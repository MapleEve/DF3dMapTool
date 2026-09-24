import { describe, expect, it } from "vitest";
import type { Vec3 } from "@/common/geometry";
import {
  aabbIntersectsFrustum,
  buildChunkRecords,
  distanceSqToPointAabb,
  selectChunks,
  sortByDistance,
  type ChunkInfo,
  type FrustumPlanes,
} from "./chunkGrid";

function info(
  id: string,
  boundsMin: [number, number, number],
  boundsMax: [number, number, number],
): ChunkInfo {
  return { id, file: `chunks/c_${id}.dmap`, boundsMin, boundsMax };
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

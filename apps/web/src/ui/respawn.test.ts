import { describe, expect, it } from "vitest";
import type { PoiCategory, PoiDefinition } from "@/poi/types";
import {
  pickRespawnPosition,
  RESPAWN_COVER_MS,
  RESPAWN_REVEAL_MS,
  RESPAWN_TELEPORT_DELAY_MS,
} from "./respawn";

const CATEGORIES: readonly PoiCategory[] = [
  { id: "t1", label: "物资点", color: "#fff", order: 1 },
  { id: "t6", label: "出生点", color: "#fff", order: 6 },
  { id: "t7", label: "撤离点", color: "#fff", order: 7 },
];

function poi(
  id: string,
  categoryId: string,
  position: { x: number; y: number; z: number },
): PoiDefinition {
  return {
    id,
    mapId: 106,
    floor: 0,
    categoryId,
    displayName: id,
    position,
  };
}

const POIS: readonly PoiDefinition[] = [
  poi("loot-1", "t1", { x: 100, y: 1, z: 100 }),
  poi("spawn-1", "t6", { x: -10, y: 2, z: 30 }),
  poi("spawn-2", "t6", { x: 40, y: 2, z: -60 }),
  poi("extract-1", "t7", { x: 0, y: 1, z: -500 }),
];

const FALLBACK = { x: -2225.77, y: 4, z: -1903 };

describe("回出生点流程参数", () => {
  it("时序：遮罩上屏 → 短延迟传送（遮罩先渲染）→ 爬升 → 99% 驻留后硬切", () => {
    expect(RESPAWN_TELEPORT_DELAY_MS).toBeGreaterThan(0);
    expect(RESPAWN_TELEPORT_DELAY_MS).toBeLessThan(RESPAWN_COVER_MS);
    expect(RESPAWN_COVER_MS).toBeGreaterThan(0);
    expect(RESPAWN_REVEAL_MS).toBeGreaterThan(RESPAWN_COVER_MS);
  });
});

describe("pickRespawnPosition", () => {
  it("出生点集内随机取一点（只取出生点分类，注入随机源可复现）", () => {
    expect(pickRespawnPosition(POIS, CATEGORIES, FALLBACK, () => 0)).toEqual({
      x: -10,
      y: 2,
      z: 30,
    });
    expect(pickRespawnPosition(POIS, CATEGORIES, FALLBACK, () => 0.99)).toEqual({
      x: 40,
      y: 2,
      z: -60,
    });
  });

  it("多次随机调用命中出生点集内（不越界到非出生点分类）", () => {
    const allowed = new Set(["-10,2,30", "40,2,-60"]);
    for (let i = 0; i < 20; i += 1) {
      const p = pickRespawnPosition(POIS, CATEGORIES, FALLBACK);
      expect(allowed.has(`${p?.x},${p?.y},${p?.z}`)).toBe(true);
    }
  });

  it("无出生点 POI 时回落地图默认出生点", () => {
    const noSpawn = [poi("loot-1", "t1", { x: 1, y: 1, z: 1 })];
    expect(pickRespawnPosition(noSpawn, CATEGORIES, FALLBACK)).toEqual(FALLBACK);
  });

  it("内置 spawn 分类 id 与 i18n 键口径亦命中", () => {
    const builtin: readonly PoiCategory[] = [
      { id: "spawn", labelKey: "poiCategory.spawn", color: "#fff", order: 6 },
    ];
    const pois = [poi("spawn-b", "spawn", { x: 7, y: 0, z: 9 })];
    expect(pickRespawnPosition(pois, builtin, FALLBACK, () => 0)).toEqual({ x: 7, y: 0, z: 9 });
  });

  it("出生点与默认出生点皆缺时返回 null（调用方按进场取景位兜底）", () => {
    expect(pickRespawnPosition([], [], null)).toBeNull();
  });
});

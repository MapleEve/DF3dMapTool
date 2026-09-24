import { describe, expect, it } from "vitest";
import type { PoiDefinition } from "./types";
import { countPoisByCategory, filterPois, passesPoiFilter } from "./filter";
import { searchPois } from "./search";

const pois: PoiDefinition[] = [
  {
    id: "a",
    mapId: 106,
    floor: 1,
    categoryId: "extract",
    displayName: "撤离点 A",
    position: { x: 0, y: 0, z: 0 },
  },
  {
    id: "b",
    mapId: 106,
    floor: 2,
    categoryId: "supply",
    displayName: "物资箱 B",
    position: { x: 1, y: 0, z: 1 },
  },
  {
    id: "c",
    mapId: 106,
    floor: 1,
    categoryId: "supply",
    displayName: "Supply Crate C",
    position: { x: 2, y: 0, z: 2 },
  },
];

describe("POI 过滤", () => {
  it("按楼层过滤", () => {
    const visible = filterPois(pois, { hiddenCategories: [], floor: 1 });
    expect(visible.map((poi) => poi.id)).toEqual(["a", "c"]);
  });

  it("按隐藏分类过滤", () => {
    const visible = filterPois(pois, { hiddenCategories: ["supply"], floor: null });
    expect(visible.map((poi) => poi.id)).toEqual(["a"]);
  });

  it("floor 为 null 时不做楼层过滤", () => {
    expect(filterPois(pois, { hiddenCategories: [], floor: null })).toHaveLength(3);
  });

  it("楼层 0（全楼层）POI 在任意楼层都可见", () => {
    const allFloorPoi: PoiDefinition = {
      id: "d",
      mapId: 106,
      floor: 0,
      categoryId: "hazard",
      displayName: "全楼层危险区",
      position: { x: 3, y: 0, z: 3 },
    };
    expect(passesPoiFilter(allFloorPoi, { hiddenCategories: [], floor: 1 })).toBe(true);
    expect(passesPoiFilter(allFloorPoi, { hiddenCategories: [], floor: 3 })).toBe(true);
    expect(passesPoiFilter(allFloorPoi, { hiddenCategories: [], floor: null })).toBe(true);
    // 楼层 0 不豁免分类隐藏。
    expect(passesPoiFilter(allFloorPoi, { hiddenCategories: ["hazard"], floor: 1 })).toBe(false);
    const visible = filterPois([...pois, allFloorPoi], { hiddenCategories: [], floor: 2 });
    expect(visible.map((poi) => poi.id)).toEqual(["b", "d"]);
  });

  it("组合过滤与单点判定一致", () => {
    const state = { hiddenCategories: ["extract" as const], floor: 2 };
    expect(passesPoiFilter(pois[1], state)).toBe(true);
    expect(filterPois(pois, state).map((poi) => poi.id)).toEqual(["b"]);
  });

  it("分类计数只统计当前楼层（楼层 0 计入任意楼层）", () => {
    const allFloorPoi: PoiDefinition = {
      id: "d",
      mapId: 106,
      floor: 0,
      categoryId: "hazard",
      displayName: "全楼层危险区",
      position: { x: 3, y: 0, z: 3 },
    };
    const counts = countPoisByCategory([...pois, allFloorPoi], {
      hiddenCategories: [],
      floor: 1,
    });
    expect(counts.get("extract")).toBe(1);
    expect(counts.get("supply")).toBe(1);
    expect(counts.get("hazard")).toBe(1);
    expect(counts.get("landmark")).toBeUndefined();
  });
});

describe("POI 检索", () => {
  it("前缀命中排在包含命中之前", () => {
    const ranked = searchPois(pois, "物资");
    expect(ranked[0]?.item.id).toBe("b");
  });

  it("多 token 要求全部命中", () => {
    expect(searchPois(pois, "supply crate").map((match) => match.item.id)).toEqual(["c"]);
    expect(searchPois(pois, "supply nothing")).toHaveLength(0);
  });

  it("空查询返回空结果", () => {
    expect(searchPois(pois, "   ")).toHaveLength(0);
  });

  it("大小写与全半角归一化", () => {
    expect(searchPois(pois, "ＳＵＰＰＬＹ").map((match) => match.item.id)).toContain("c");
  });
});

import { describe, expect, it } from "vitest";
import type { PoiDefinition } from "./types";
import { availableMapModes, countPoisByCategory, filterPois, passesPoiFilter } from "./filter";
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
    const visible = filterPois(pois, { hiddenCategories: [], floor: 1, mode: null });
    expect(visible.map((poi) => poi.id)).toEqual(["a", "c"]);
  });

  it("按隐藏分类过滤", () => {
    const visible = filterPois(pois, { hiddenCategories: ["supply"], floor: null, mode: null });
    expect(visible.map((poi) => poi.id)).toEqual(["a"]);
  });

  it("floor 为 null 时不做楼层过滤", () => {
    expect(filterPois(pois, { hiddenCategories: [], floor: null, mode: null })).toHaveLength(3);
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
    expect(passesPoiFilter(allFloorPoi, { hiddenCategories: [], floor: 1, mode: null })).toBe(true);
    expect(passesPoiFilter(allFloorPoi, { hiddenCategories: [], floor: 3, mode: null })).toBe(true);
    expect(passesPoiFilter(allFloorPoi, { hiddenCategories: [], floor: null, mode: null })).toBe(
      true,
    );
    // 楼层 0 不豁免分类隐藏。
    expect(
      passesPoiFilter(allFloorPoi, { hiddenCategories: ["hazard"], floor: 1, mode: null }),
    ).toBe(false);
    const visible = filterPois([...pois, allFloorPoi], {
      hiddenCategories: [],
      floor: 2,
      mode: null,
    });
    expect(visible.map((poi) => poi.id)).toEqual(["b", "d"]);
  });

  it("组合过滤与单点判定一致", () => {
    const state = { hiddenCategories: ["extract" as const], floor: 2, mode: null };
    expect(passesPoiFilter(pois[1], state)).toBe(true);
    expect(filterPois(pois, state).map((poi) => poi.id)).toEqual(["b"]);
  });

  it("按玩法模式过滤：模式不一致/无模式字段的 POI 不显示", () => {
    const mixed: PoiDefinition[] = [
      { ...pois[0], meta: { mapMode: 2 } },
      { ...pois[1], meta: { mapMode: 3 } },
      { ...pois[2] },
    ];
    // mode=2 只留机密档点位。
    expect(
      filterPois(mixed, { hiddenCategories: [], floor: null, mode: 2 }).map((poi) => poi.id),
    ).toEqual(["a"]);
    // mode=3 只留绝密档点位。
    expect(
      filterPois(mixed, { hiddenCategories: [], floor: null, mode: 3 }).map((poi) => poi.id),
    ).toEqual(["b"]);
    // 无模式字段的 POI 在有模式过滤时不显示（数据包内全量 POI 均带 mapMode）。
    expect(passesPoiFilter(mixed[2], { hiddenCategories: [], floor: null, mode: 2 })).toBe(false);
    // mode=null 不做模式过滤。
    expect(filterPois(mixed, { hiddenCategories: [], floor: null, mode: null })).toHaveLength(3);
  });

  it("分类计数只统计当前楼层与模式（楼层 0 计入任意楼层）", () => {
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
      mode: null,
    });
    expect(counts.get("extract")).toBe(1);
    expect(counts.get("supply")).toBe(1);
    expect(counts.get("hazard")).toBe(1);
    expect(counts.get("landmark")).toBeUndefined();

    // 模式过滤参与计数：仅统计该模式的点位。
    const modeCounts = countPoisByCategory(
      [
        { ...pois[0], meta: { mapMode: 2 } },
        { ...pois[1], meta: { mapMode: 3 } },
        { ...pois[2], meta: { mapMode: 2 } },
      ],
      { hiddenCategories: [], floor: null, mode: 2 },
    );
    expect(modeCounts.get("extract")).toBe(1);
    expect(modeCounts.get("supply")).toBe(1);
  });
});

describe("玩法模式可用集", () => {
  it("mapMode 去重升序；无模式字段的 POI 不参与", () => {
    const mixed: PoiDefinition[] = [
      { ...pois[0], meta: { mapMode: 3 } },
      { ...pois[1], meta: { mapMode: 2 } },
      { ...pois[2], meta: { mapMode: 2 } },
      pois[0],
    ];
    expect(availableMapModes(mixed)).toEqual([2, 3]);
    expect(availableMapModes([])).toEqual([]);
    expect(availableMapModes([pois[0], pois[1]])).toEqual([]);
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

/**
 * 过滤函数测试（设计 §4.3 验收锚点 2：上游过滤语义逐条行为）。
 *
 * 逐条锚定 chunk 实证（勿"好心修正"）：
 * - z=null 的点位在具体楼层被隐藏（e.z===parseInt(floor)）
 * - difficulties 缺失/非数组时难度过滤通过
 * - selectedItems 空集 = 无标记
 * - location 三元组（item/x/y）精确匹配
 * - selectAll=true（侧栏计数口径）忽略勾选
 */

import { describe, expect, it } from "vitest";
import { countPointsByItem, DEFAULT_SANDBOX_FILTERS, filterSandboxPoints } from "./filter";
import type { SandboxPoint } from "./types";

function point(overrides: Partial<SandboxPoint>): SandboxPoint {
  return {
    id: 1,
    item: "bird-nest",
    x: 100,
    y: 200,
    floor: null,
    difficulties: null,
    nameEn: null,
    titleEn: "Bird Nest",
    titleZh: "鸟巢",
    descEn: null,
    media: "media/abc.webp",
    shot: null,
    updatedAt: null,
    randomSpawn: false,
    validated: true,
    bgColor: null,
    ...overrides,
  };
}

describe("难度过滤（上游短路语义）", () => {
  const points = [
    point({ id: 1, difficulties: ["easy", "normal"] }),
    point({ id: 2, difficulties: [] }),
    point({ id: 3, difficulties: null }),
  ];

  it("mode=all 全通过", () => {
    expect(
      filterSandboxPoints(points, {
        ...DEFAULT_SANDBOX_FILTERS,
        difficulty: "all",
        selectedItems: ["bird-nest"],
      }),
    ).toHaveLength(3);
  });

  it("easy：数组含 easy 通过；空数组不过；difficulties 缺失（null）通过", () => {
    const result = filterSandboxPoints(points, {
      ...DEFAULT_SANDBOX_FILTERS,
      difficulty: "easy",
      selectedItems: ["bird-nest"],
    });
    expect(result.map((p) => p.id)).toEqual([1, 3]);
  });
});

describe("楼层过滤（z=null 在具体楼层隐藏——实测锚定，勿修正）", () => {
  const points = [
    point({ id: 1, floor: null }),
    point({ id: 2, floor: -1 }),
    point({ id: 3, floor: 0 }),
  ];

  it("floor=all 全通过（含 null）", () => {
    const result = filterSandboxPoints(points, {
      ...DEFAULT_SANDBOX_FILTERS,
      floor: "all",
      selectedItems: ["bird-nest"],
    });
    expect(result).toHaveLength(3);
  });

  it("floor=-1：仅 z===-1；z=null 被隐藏", () => {
    const result = filterSandboxPoints(points, {
      ...DEFAULT_SANDBOX_FILTERS,
      floor: "-1",
      selectedItems: ["bird-nest"],
    });
    expect(result.map((p) => p.id)).toEqual([2]);
  });

  it("floor=0：仅 z===0", () => {
    const result = filterSandboxPoints(points, {
      ...DEFAULT_SANDBOX_FILTERS,
      floor: "0",
      selectedItems: ["bird-nest"],
    });
    expect(result.map((p) => p.id)).toEqual([3]);
  });
});

describe("分类勾选（空集 = 无标记上图）", () => {
  const points = [point({ id: 1, item: "bird-nest" }), point({ id: 2, item: "key_card" })];

  it("默认（空集）无点位", () => {
    expect(filterSandboxPoints(points, DEFAULT_SANDBOX_FILTERS)).toHaveLength(0);
  });

  it("勾选 bird-nest 仅该类", () => {
    const result = filterSandboxPoints(points, {
      ...DEFAULT_SANDBOX_FILTERS,
      selectedItems: ["bird-nest"],
    });
    expect(result.map((p) => p.id)).toEqual([1]);
  });

  it("selectAll=true 忽略勾选（侧栏计数口径）", () => {
    expect(filterSandboxPoints(points, DEFAULT_SANDBOX_FILTERS, true)).toHaveLength(2);
  });
});

describe("具名点位 location 三元组精确匹配", () => {
  const points = [
    point({ id: 1, item: "key_card", x: 1054, y: 1892 }),
    point({ id: 2, item: "key_card", x: 1127, y: 2151 }),
    point({ id: 3, item: "bird-nest", x: 1054, y: 1892 }),
  ];

  it("item+x+y 全等才通过", () => {
    const result = filterSandboxPoints(points, {
      ...DEFAULT_SANDBOX_FILTERS,
      location: { item: "key_card", x: 1054, y: 1892 },
      selectedItems: ["key_card", "bird-nest"],
    });
    expect(result.map((p) => p.id)).toEqual([1]);
  });

  it("同类不同坐标不通过", () => {
    const result = filterSandboxPoints(points, {
      ...DEFAULT_SANDBOX_FILTERS,
      location: { item: "key_card", x: 9999, y: 9999 },
      selectedItems: ["key_card"],
    });
    expect(result).toHaveLength(0);
  });
});

describe("countPointsByItem（侧栏角标：不含勾选）", () => {
  it("计数忽略 selectedItems，但受楼层/难度约束", () => {
    const points = [
      point({ id: 1, item: "bird-nest", floor: -1 }),
      point({ id: 2, item: "bird-nest", floor: -1 }),
      point({ id: 3, item: "bird-nest", floor: 0 }),
      point({ id: 4, item: "key_card", floor: -1, difficulties: ["normal"] }),
    ];
    const counts = countPointsByItem(points, {
      ...DEFAULT_SANDBOX_FILTERS,
      floor: "-1",
      difficulty: "easy",
      selectedItems: [],
    });
    // key_card 点 difficulties=["normal"] 不含 easy → 不入计数；bird-nest 两点 difficulties 缺失 → 通过
    expect(counts.get("bird-nest")).toBe(2);
    expect(counts.has("key_card")).toBe(false);
  });
});

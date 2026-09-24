import { describe, expect, it } from "vitest";
import { deriveFloorBands, floorForY } from "./floorBands";

/** az3 实测触发体（scene.json 提取，Y 为关键量）。 */
const AZ3_TRIGGERS: readonly {
  floor: number;
  boundsCenter: readonly [number, number, number];
  boundsExtent: readonly [number, number, number];
}[] = [
  { floor: 2, boundsCenter: [-2045.377, 20.04, -2171.575], boundsExtent: [70.312, 7.957, 88.125] },
  { floor: 2, boundsCenter: [-1736.88, 14.641, -2255.691], boundsExtent: [14.375, 3.0, 19.688] },
  { floor: 2, boundsCenter: [-2278.298, 8.76, -1915.455], boundsExtent: [39.738, 3.0, 47.5] },
  { floor: 3, boundsCenter: [-2045.957, 36.535, -2171.575], boundsExtent: [66.25, 8.438, 86.25] },
  { floor: 1, boundsCenter: [-1733.99, 4.0, -2255.691], boundsExtent: [46.875, 6.562, 46.875] },
  { floor: 1, boundsCenter: [-2276.9551, 1.777, -1915.38], boundsExtent: [38.388, 3.938, 43.107] },
  { floor: 1, boundsCenter: [-2046.377, -2.007, -2171.575], boundsExtent: [69.375, 13.5, 69.375] },
];

describe("楼层分带", () => {
  it("az3 三层按触发体中心高度分带，边界取相邻均值中点", () => {
    const bands = deriveFloorBands([1, 2, 3], AZ3_TRIGGERS);
    expect(bands.map((band) => band.floor)).toEqual([1, 2, 3]);
    // 触发体中心均值：floor1 ≈ 1.2567、floor2 ≈ 14.48、floor3 = 36.535
    const [f1, f2, f3] = bands;
    expect(f1.yMin).toBe(Number.NEGATIVE_INFINITY);
    expect(f1.yMax).toBeCloseTo((1.2567 + 14.4803) / 2, 1);
    expect(f2.yMin).toBeCloseTo(f1.yMax, 5);
    expect(f2.yMax).toBeCloseTo((14.4803 + 36.535) / 2, 1);
    expect(f3.yMin).toBeCloseTo(f2.yMax, 5);
    expect(f3.yMax).toBe(Number.POSITIVE_INFINITY);
  });

  it("floorForY：带内归属、边界归上层、越界归最近带", () => {
    const bands = deriveFloorBands([1, 2, 3], AZ3_TRIGGERS);
    const boundary = bands[0].yMax;
    expect(floorForY(bands, -78)).toBe(1);
    expect(floorForY(bands, 5)).toBe(1);
    expect(floorForY(bands, boundary)).toBe(2);
    expect(floorForY(bands, 20)).toBe(2);
    expect(floorForY(bands, 40)).toBe(3);
    expect(floorForY(bands, 203.294)).toBe(3);
  });

  it("无触发体时退化为单一分带（单层地图）", () => {
    const bands = deriveFloorBands([1], []);
    expect(bands).toHaveLength(1);
    expect(bands[0].floor).toBe(1);
    expect(floorForY(bands, 12345)).toBe(1);
  });

  it("多楼层但全部缺触发体：退化为首层单一分带，保证对象可见", () => {
    const bands = deriveFloorBands([1, 2, 3], []);
    expect(bands).toHaveLength(1);
    expect(bands[0].floor).toBe(1);
    expect(floorForY(bands, 60)).toBe(1);
  });

  it("缺失中间楼层触发体时按相邻已知楼层插值补齐", () => {
    const triggers: readonly {
      floor: number;
      boundsCenter: readonly [number, number, number];
      boundsExtent: readonly [number, number, number];
    }[] = [
      { floor: 1, boundsCenter: [0, 0, 0], boundsExtent: [1, 1, 1] },
      { floor: 3, boundsCenter: [0, 40, 0], boundsExtent: [1, 1, 1] },
    ];
    const bands = deriveFloorBands([1, 2, 3], triggers);
    expect(bands.map((band) => band.floor)).toEqual([1, 2, 3]);
    // 中间层高度补在 0 与 40 的中点（20），分带边界再取相邻高度中点（10/30）
    expect(bands[1].yMin).toBeCloseTo(10, 1);
    expect(bands[1].yMax).toBeCloseTo(30, 1);
    // 分带单调不交叠
    expect(bands[0].yMax).toBeCloseTo(bands[1].yMin, 5);
    expect(bands[1].yMax).toBeCloseTo(bands[2].yMin, 5);
  });

  it("未知楼层触发体被忽略", () => {
    const triggers: readonly {
      floor: number;
      boundsCenter: readonly [number, number, number];
      boundsExtent: readonly [number, number, number];
    }[] = [...AZ3_TRIGGERS, { floor: 99, boundsCenter: [0, -1000, 0], boundsExtent: [1, 1, 1] }];
    const bands = deriveFloorBands([1, 2, 3], triggers);
    expect(bands).toHaveLength(3);
    expect(bands[0].floor).toBe(1);
  });
});

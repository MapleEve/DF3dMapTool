import { describe, expect, it } from "vitest";
import { StreamProgressAggregator } from "../src/progress.js";

describe("StreamProgressAggregator", () => {
  it("多流份额聚合为已载/总实例分数", () => {
    const progress = new StreamProgressAggregator(1000);
    expect(progress.fraction).toBe(0);
    // 6 路并行流各自完成一个分块，份额不同。
    expect(progress.report(120)).toBeCloseTo(0.12, 10);
    expect(progress.report(80)).toBeCloseTo(0.2, 10);
    expect(progress.report(300)).toBeCloseTo(0.5, 10);
    expect(progress.loaded).toBe(500);
    expect(progress.report(500)).toBe(1);
    expect(progress.loaded).toBe(1000);
  });

  it("卸载以负份额回落，分数夹在 [0, 1]", () => {
    const progress = new StreamProgressAggregator(100);
    progress.report(60);
    expect(progress.fraction).toBeCloseTo(0.6, 10);
    // 离开渲染半径：分块卸载。
    progress.report(-30);
    expect(progress.fraction).toBeCloseTo(0.3, 10);
    // 越界份额不会把分数推出 [0, 1]。
    progress.report(-500);
    expect(progress.fraction).toBe(0);
    progress.report(9999);
    expect(progress.fraction).toBe(1);
  });

  it("非法构造与非法份额拒绝", () => {
    expect(() => new StreamProgressAggregator(0)).toThrow(RangeError);
    expect(() => new StreamProgressAggregator(-5)).toThrow(RangeError);
    expect(() => new StreamProgressAggregator(Number.NaN)).toThrow(RangeError);
    const progress = new StreamProgressAggregator(10);
    expect(() => progress.report(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

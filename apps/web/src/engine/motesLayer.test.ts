import { describe, expect, it } from "vitest";
import { Points } from "three";
import { createMotesLayer, MOTES_LAYER_ID } from "./motesLayer";

/** 从层根取 Points 网格的位置缓冲。 */
function positionsOf(layer: ReturnType<typeof createMotesLayer>): Float32Array {
  const points = layer.root.children.find((child) => child instanceof Points);
  if (!(points instanceof Points)) {
    throw new Error("motes layer root 应包含 Points 网格");
  }
  const attribute = points.geometry.getAttribute("position");
  return attribute.array as Float32Array;
}

describe("环境漂浮粒子层（「环境漂浮粒子」设置项）", () => {
  it("层 id 固定；初始粒子落在焦点活动盒内", () => {
    const layer = createMotesLayer({ count: 60, getFocus: () => ({ x: 100, y: 0, z: -50 }) });
    expect(layer.id).toBe(MOTES_LAYER_ID);
    const positions = positionsOf(layer);
    expect(positions).toHaveLength(60 * 3);
    for (let i = 0; i < 60; i += 1) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      expect(Math.abs(x - 100)).toBeLessThanOrEqual(90);
      expect(y).toBeGreaterThanOrEqual(-20);
      expect(y).toBeLessThanOrEqual(-20 + 60);
      expect(Math.abs(z + 50)).toBeLessThanOrEqual(90);
    }
    layer.dispose();
  });

  it("漂移后仍约束在焦点活动盒内（越界环绕回盒）", () => {
    const layer = createMotesLayer({
      count: 80,
      halfExtent: 40,
      height: 30,
      getFocus: () => ({ x: 1000, y: 10, z: 2000 }),
    });
    // 大步长推进：粒子必然越界并触发环绕。
    layer.update?.(120);
    const positions = positionsOf(layer);
    for (let i = 0; i < 80; i += 1) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      expect(Math.abs(x - 1000)).toBeLessThanOrEqual(40);
      // y 盒：焦点 y + 基准偏移 -20 起、高 30。
      expect(y).toBeGreaterThanOrEqual(10 - 20);
      expect(y).toBeLessThanOrEqual(10 - 20 + 30);
      expect(Math.abs(z - 2000)).toBeLessThanOrEqual(40);
    }
    layer.dispose();
  });

  it("焦点移动后粒子群随焦点重定位（环绕以当前焦点为中心）", () => {
    let focus = { x: 0, y: 0, z: 0 };
    const layer = createMotesLayer({ count: 40, getFocus: () => focus });
    layer.update?.(1);
    focus = { x: 500, y: 0, z: 500 };
    // 焦点移动后继续推进：粒子被拉回新焦点盒（dx 超半宽即环绕）。
    layer.update?.(1);
    const positions = positionsOf(layer);
    for (let i = 0; i < 40; i += 1) {
      const dx = positions[i * 3] - 500;
      // 首帧环绕按新旧焦点差逐粒判定：移动距离 500 > 2×半宽（90），
      // 环绕后必落在新盒内。
      expect(Math.abs(dx)).toBeLessThanOrEqual(90);
    }
    layer.dispose();
  });

  it("update 多帧推进与 dispose 不抛异常", () => {
    const layer = createMotesLayer({ count: 20 });
    expect(() => {
      for (let frame = 0; frame < 10; frame += 1) {
        layer.update?.(1 / 60);
      }
    }).not.toThrow();
    expect(() => layer.dispose()).not.toThrow();
  });

  it("Points 网格关闭视锥剔除（位置就地重写，缓存包围球会整层误剔除）", () => {
    const layer = createMotesLayer({ count: 10 });
    const points = layer.root.children.find((child) => child instanceof Points);
    expect(points).toBeInstanceOf(Points);
    // 回归口径：层先建后载图时初始布点在世界原点盒，而地图世界坐标远离原点——
    // 若依赖缓存包围球，整个网格会被视锥剔除为永不渲染。
    expect((points as Points).frustumCulled).toBe(false);
    layer.dispose();
  });
});

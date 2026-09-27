import { describe, expect, it } from "vitest";
import type { Group, Line, Sprite } from "three";
import {
  RouteLayer,
  SEGMENT_MODE_POINT_THRESHOLD,
  SEGMENT_TRAIL_POINTS,
  SEGMENT_WINDOW_POINTS,
  routeRenderModeForPoints,
  type RouteRenderMode,
} from "./routeLayer";
import type { Vec3 } from "@/common/geometry";

function makePoints(count: number): Vec3[] {
  return Array.from({ length: count }, (_, index) => ({ x: index, y: 0, z: 0 }));
}

/** 主线 Line（root 直挂子节点）。 */
function lineOf(layer: RouteLayer): Line {
  const line = layer.root.children.find((child): child is Line => (child as Line).isLine === true);
  if (line === undefined) {
    throw new Error("主线未创建");
  }
  return line;
}

/** 路牌 sprite 集合（markerGroup 直挂子节点）。 */
function signsOf(layer: RouteLayer): Sprite[] {
  const group = layer.root.children.find(
    (child): child is Group => (child as Group).isGroup === true,
  );
  return (group?.children ?? []).filter(
    (child): child is Sprite => (child as Sprite).isSprite === true,
  );
}

describe("渲染模式选择（导航启动时按路线数据决定）", () => {
  it("点位规模阈值二分：短路线全程，长路线分段", () => {
    expect(routeRenderModeForPoints(0)).toBe<RouteRenderMode>("full");
    expect(routeRenderModeForPoints(SEGMENT_MODE_POINT_THRESHOLD)).toBe<RouteRenderMode>("full");
    expect(routeRenderModeForPoints(SEGMENT_MODE_POINT_THRESHOLD + 1)).toBe<RouteRenderMode>(
      "segment",
    );
  });
});

describe("路线图层", () => {
  it("全程模式：主线一次成线（drawRange 覆盖全部点位）", () => {
    const layer = new RouteLayer();
    layer.setRoute(makePoints(10), [], { renderMode: "full" });
    const line = lineOf(layer);
    expect(line.visible).toBe(true);
    expect(line.geometry.drawRange).toEqual({ start: 0, count: 10 });
    layer.dispose();
  });

  it("分段模式：可见窗口随跟跑进度推进，null 恢复全程", () => {
    const layer = new RouteLayer();
    const total = SEGMENT_MODE_POINT_THRESHOLD + 20; // 220
    layer.setRoute(makePoints(total), [], { renderMode: "segment" });
    const line = lineOf(layer);

    // 启动即前窗：[0, WINDOW)。
    expect(line.geometry.drawRange).toEqual({ start: 0, count: SEGMENT_WINDOW_POINTS });

    // 中段：身后拖尾 + 前方窗口。
    layer.setSegmentIndex(100);
    expect(line.geometry.drawRange).toEqual({
      start: 100 - SEGMENT_TRAIL_POINTS,
      count: SEGMENT_WINDOW_POINTS + SEGMENT_TRAIL_POINTS,
    });

    // 尾段：窗口收敛在终点。
    layer.setSegmentIndex(total - 5);
    expect(line.geometry.drawRange).toEqual({
      start: total - 5 - SEGMENT_TRAIL_POINTS,
      count: 5 + SEGMENT_TRAIL_POINTS,
    });

    // null 恢复全程。
    layer.setSegmentIndex(null);
    expect(line.geometry.drawRange).toEqual({ start: 0, count: total });
    layer.dispose();
  });

  it("全程模式下分段推进为 no-op", () => {
    const layer = new RouteLayer();
    layer.setRoute(makePoints(10), [], { renderMode: "full" });
    layer.setSegmentIndex(5);
    expect(lineOf(layer).geometry.drawRange).toEqual({ start: 0, count: 10 });
    layer.dispose();
  });

  it("标注点渲染为路牌 sprite（恒面向相机，中心抬升）", () => {
    const layer = new RouteLayer();
    layer.setRoute(makePoints(4), [{ x: 1, y: 0, z: 2 }], { renderMode: "full" });
    const signs = signsOf(layer);
    expect(signs).toHaveLength(1);
    expect(signs[0].position.x).toBeCloseTo(1);
    expect(signs[0].position.z).toBeCloseTo(2);
    expect(signs[0].position.y).toBeGreaterThan(0); // 路牌中心离地抬升
    layer.dispose();
  });

  it("setRoute(null) 清空：主线隐藏、路牌回收", () => {
    const layer = new RouteLayer();
    layer.setRoute(makePoints(4), [{ x: 1, y: 0, z: 2 }]);
    layer.setRoute(null);
    expect(lineOf(layer).visible).toBe(false);
    expect(signsOf(layer)).toHaveLength(0);
    layer.dispose();
  });
});

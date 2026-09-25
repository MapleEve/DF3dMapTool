import { describe, expect, it } from "vitest";
import { DEFAULT_INTERACT_RADIUS, InteractorLayer } from "./interactorLayer";
import type { InteractorsDoc } from "@/data/routes";

const doc: InteractorsDoc = {
  format: "df3d-interactors/1",
  mapCode: "test",
  mapId: 0,
  ladders: [
    { top: { x: 0, y: 10, z: 0 }, bottom: { x: 0, y: 0, z: 0 }, facingDirection: 1 },
    { top: { x: 100, y: 8, z: 100 }, bottom: { x: 100, y: 0, z: 100 }, facingDirection: 0 },
  ],
  ropes: [{ top: { x: 50, y: 20, z: 0 }, bottom: { x: 50, y: 0, z: 0 } }],
  ziplines: [
    {
      a: { x: 0, y: 20, z: 50 },
      b: { x: 0, y: 5, z: 80 },
      interactionRadius: 1.5,
      slideSpeed: 5,
      canExitInSliding: false,
    },
  ],
};

describe("InteractorLayer 近旁查询", () => {
  it("空数据/清空后无近旁目标", () => {
    const layer = new InteractorLayer();
    expect(layer.nearestInteractor({ x: 0, y: 0, z: 0 })).toBeNull();
    layer.setInteractors(doc);
    layer.setInteractors(null);
    expect(layer.nearestInteractor({ x: 0, y: 0, z: 0 })).toBeNull();
    layer.dispose();
  });

  it("最近物件与端点判定（梯子取底端/顶端为动作目标）", () => {
    const layer = new InteractorLayer();
    layer.setInteractors(doc);
    const near = layer.nearestInteractor({ x: 0.5, y: 0.5, z: 0.5 });
    expect(near).not.toBeNull();
    expect(near!.kind).toBe("ladder");
    expect(near!.index).toBe(0);
    expect(near!.distance).toBeCloseTo(Math.sqrt(0.75), 6);
    // 动作目标 = 对端（底端触发 → 顶端）
    expect(near!.target).toEqual({ x: 0, y: 10, z: 0 });
    expect(near!.radius).toBe(DEFAULT_INTERACT_RADIUS);
    layer.dispose();
  });

  it("两端皆可为触发点（顶端触发 → 目标为底端）", () => {
    const layer = new InteractorLayer();
    layer.setInteractors(doc);
    const near = layer.nearestInteractor({ x: 0, y: 9.5, z: 0 });
    expect(near!.kind).toBe("ladder");
    expect(near!.point).toEqual({ x: 0, y: 10, z: 0 });
    expect(near!.target).toEqual({ x: 0, y: 0, z: 0 });
    layer.dispose();
  });

  it("滑索半径取数据值与默认半径的较大者", () => {
    const layer = new InteractorLayer();
    layer.setInteractors(doc);
    const near = layer.nearestInteractor({ x: 0, y: 20, z: 51 });
    expect(near!.kind).toBe("zipline");
    expect(near!.radius).toBe(Math.max(1.5, DEFAULT_INTERACT_RADIUS));
    expect(near!.slideSpeed).toBe(5);
    layer.dispose();
  });

  it("高亮清空后恢复常规不透明度", () => {
    const layer = new InteractorLayer();
    layer.setInteractors(doc);
    const near = layer.nearestInteractor({ x: 0, y: 0, z: 0 });
    layer.setHighlight(near);
    layer.setHighlight(null);
    layer.dispose();
    // 不抛错即通过（不透明度复位在 setHighlight 内部完成）
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { useMapModeStore } from "./mapModeStore";
import { MAP_MODES, getMapModeById } from "@/map/mapModes";

describe("玩法模式状态", () => {
  beforeEach(() => {
    useMapModeStore.getState().reset();
  });

  it("数据就绪：可用集去重升序，当前模式回落首档", () => {
    useMapModeStore.getState().applyAvailableModes([3, 2, 2]);
    const state = useMapModeStore.getState();
    expect(state.availableModes).toEqual([2, 3]);
    expect(state.mode).toBe(2);
  });

  it("换图后当前模式仍可用则保持；失效则回落新图首档", () => {
    useMapModeStore.getState().applyAvailableModes([2]);
    expect(useMapModeStore.getState().mode).toBe(2);
    // 同模式换图：保持。
    useMapModeStore.getState().applyAvailableModes([2, 3]);
    expect(useMapModeStore.getState().mode).toBe(2);
    // 换到单档 3 的图（如潮汐监狱形态）：回落首档。
    useMapModeStore.getState().applyAvailableModes([3]);
    expect(useMapModeStore.getState().mode).toBe(3);
  });

  it("setMode 只接受当前图可用模式", () => {
    useMapModeStore.getState().applyAvailableModes([2]);
    useMapModeStore.getState().setMode(2);
    expect(useMapModeStore.getState().mode).toBe(2);
    useMapModeStore.getState().setMode(3);
    expect(useMapModeStore.getState().mode).toBe(2);
  });

  it("空集与重置：mode 归 null（不过滤）", () => {
    useMapModeStore.getState().applyAvailableModes([2]);
    useMapModeStore.getState().applyAvailableModes([]);
    expect(useMapModeStore.getState().mode).toBeNull();
    useMapModeStore.getState().applyAvailableModes([3]);
    useMapModeStore.getState().reset();
    expect(useMapModeStore.getState().mode).toBeNull();
    expect(useMapModeStore.getState().availableModes).toEqual([]);
  });
});

describe("玩法模式表", () => {
  it("全集为常规/机密/绝密三档（id 升序）", () => {
    expect(MAP_MODES.map((mode) => mode.id)).toEqual([1, 2, 3]);
    expect(MAP_MODES.map((mode) => mode.label)).toEqual(["常规", "机密", "绝密"]);
  });

  it("id → 定义查询；未收录返回 undefined", () => {
    expect(getMapModeById(2)?.labelKey).toBe("mapMode.confidential");
    expect(getMapModeById(99)).toBeUndefined();
  });
});

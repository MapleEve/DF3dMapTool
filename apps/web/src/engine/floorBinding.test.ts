import { beforeEach, describe, expect, it } from "vitest";
import { useFloorStore } from "@/state/floorStore";
import { FloorManager } from "./floorManager";
import { connectFloorStore } from "./floorBinding";

/**
 * 楼层对接回归：store.floor 是双视图共享值（取值域 = 3D 楼层 ∪ 2D 沙盘楼层），
 * 域外值（仅沙盘提供的楼层）不得下发给场景——保持上一有效渲染。
 */
describe("connectFloorStore：域外楼层值防御", () => {
  let manager: FloorManager;
  let unsubscribe: () => void;

  beforeEach(() => {
    manager = new FloorManager({ dimInactive: true, dimOpacity: 0.18 });
    useFloorStore.setState({
      floors: [1],
      sandboxFloors: null,
      floorOptions: [1],
      floor: 1,
    });
    unsubscribe = connectFloorStore(manager);
    return () => {
      unsubscribe();
      manager.clear();
    };
  });

  it("域内值正常下发场景", () => {
    useFloorStore.getState().applyFloors([-1, 1, 2], 1);
    expect(manager.activeFloor).toBe(1);
    useFloorStore.getState().setFloor(2);
    expect(manager.activeFloor).toBe(2);
  });

  it("域外值（仅 2D 沙盘提供的楼层）保持上一有效渲染", () => {
    // 3D 楼层 [1]，沙盘贡献楼层 [-1,1,2,3]：选中 3（沙盘独有）。
    useFloorStore.getState().applyFloors([1], 1);
    useFloorStore.getState().setSandboxFloors([-1, 1, 2, 3]);
    useFloorStore.getState().setFloor(3);
    // 引擎仍渲染上一有效楼层（1），不因域外值整场淡化/清空。
    expect(manager.activeFloor).toBe(1);
    // 切回域内值恢复下发。
    useFloorStore.getState().setFloor(1);
    expect(manager.activeFloor).toBe(1);
  });

  it("楼层表变化时若当前值域外，回退列表首项（防御路径）", () => {
    useFloorStore.setState({ floors: [1, 2], floor: 3 });
    // 3D 楼层表变为 [1,2] 而选中值为域外 3：不把 3 下发，落到列表首项。
    expect(manager.activeFloor).toBe(1);
  });
});

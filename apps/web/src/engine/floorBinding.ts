import { useFloorStore } from "@/state/floorStore";
import type { FloorManager } from "./floorManager";

/**
 * 楼层状态对接：以楼层 store 为唯一事实来源，单向驱动 FloorManager。
 * 返回取消订阅函数（换图/销毁视口时调用）。
 *
 * store.floor 是双视图共享的选中值（取值域 = 3D 楼层 ∪ 2D 沙盘楼层）：
 * 值不在 3D 楼层域内（仅沙盘提供的楼层）时保持场景上一有效渲染，
 * 不把域外值下发给楼层系统（2D/3D 部分耦合的尽力同步语义）。
 */
export function connectFloorStore(manager: FloorManager): () => void {
  const sync = (state: { floors: readonly number[]; floor: number }): void => {
    if (
      manager.availableFloors.length !== state.floors.length ||
      manager.availableFloors.some((floor, index) => floor !== state.floors[index])
    ) {
      manager.setAvailableFloors(
        state.floors,
        state.floors.includes(state.floor) ? state.floor : undefined,
      );
      return;
    }
    if (!state.floors.includes(state.floor)) {
      return;
    }
    manager.setActiveFloor(state.floor);
  };
  sync(useFloorStore.getState());
  return useFloorStore.subscribe(sync);
}

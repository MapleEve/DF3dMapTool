import { useFloorStore } from '@/state/floorStore';
import type { FloorManager } from './floorManager';

/**
 * 楼层状态对接：以楼层 store 为唯一事实来源，单向驱动 FloorManager。
 * 返回取消订阅函数（换图/销毁视口时调用）。
 */
export function connectFloorStore(manager: FloorManager): () => void {
  const sync = (state: { floors: readonly number[]; floor: number }): void => {
    if (
      manager.availableFloors.length !== state.floors.length ||
      manager.availableFloors.some((floor, index) => floor !== state.floors[index])
    ) {
      manager.setAvailableFloors(state.floors, state.floor);
      return;
    }
    manager.setActiveFloor(state.floor);
  };
  sync(useFloorStore.getState());
  return useFloorStore.subscribe(sync);
}

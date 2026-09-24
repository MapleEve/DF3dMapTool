import { create } from "zustand";

interface FloorStoreState {
  /** 当前地图可用楼层（升序，含地下层负数）；数据包 manifest 优先，未加载时为注册表标定值。 */
  floors: readonly number[];
  floor: number;
  applyFloors: (floors: readonly number[], floor: number) => void;
  setFloor: (floor: number) => void;
}

export const useFloorStore = create<FloorStoreState>()((set) => ({
  floors: [1],
  floor: 1,
  applyFloors: (floors, floor) => set({ floors, floor }),
  setFloor: (floor) => set({ floor }),
}));

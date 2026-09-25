import { create } from "zustand";
import { mergeFloorOptions } from "./floorCoupling";

interface FloorStoreState {
  /** 当前地图 3D 场景楼层（升序，含地下层负数）；数据包 manifest 优先，未加载时为注册表标定值。 */
  floors: readonly number[];
  /**
   * 2D 沙盘楼层（站点楼层映射到应用域后的值域）；null 表示沙盘数据未加载。
   * 由 2D 沙盘数据层在加载/复位时回填（setSandboxFloors），3D 侧只读。
   */
  sandboxFloors: readonly number[] | null;
  /** 楼层选项 = 3D 楼层 ∪ 沙盘楼层（升序去重）；楼层选择器展示，双视图共享。 */
  floorOptions: readonly number[];
  floor: number;
  applyFloors: (floors: readonly number[], floor: number) => void;
  /** 2D 沙盘数据层回填/清空沙盘楼层值域（应用域）。 */
  setSandboxFloors: (floors: readonly number[] | null) => void;
  setFloor: (floor: number) => void;
}

export const useFloorStore = create<FloorStoreState>()((set) => ({
  floors: [1],
  sandboxFloors: null,
  floorOptions: [1],
  floor: 1,
  applyFloors: (floors, floor) =>
    set((state) => ({
      floors,
      floor,
      floorOptions: mergeFloorOptions(floors, state.sandboxFloors),
    })),
  setSandboxFloors: (sandboxFloors) =>
    set((state) => ({
      sandboxFloors,
      floorOptions: mergeFloorOptions(state.floors, sandboxFloors),
    })),
  setFloor: (floor) => set({ floor }),
}));

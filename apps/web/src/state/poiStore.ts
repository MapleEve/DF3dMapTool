import { create } from "zustand";
import type { Vec3 } from "@/common/geometry";

/** 相机飞入请求：token 自增以触发同一目标的重复飞行。 */
export interface FlyToTarget {
  readonly position: Vec3;
  readonly token: number;
}

interface PoiStoreState {
  selectedPoiId: string | null;
  flyToTarget: FlyToTarget | null;
  selectPoi: (poiId: string | null) => void;
  requestFlyTo: (position: Vec3) => void;
  consumeFlyTo: () => void;
}

export const usePoiStore = create<PoiStoreState>()((set, get) => ({
  selectedPoiId: null,
  flyToTarget: null,
  selectPoi: (selectedPoiId) => set({ selectedPoiId }),
  requestFlyTo: (position) =>
    set((state) => ({ flyToTarget: { position, token: (state.flyToTarget?.token ?? 0) + 1 } })),
  consumeFlyTo: () => {
    if (get().flyToTarget !== null) {
      set({ flyToTarget: null });
    }
  },
}));

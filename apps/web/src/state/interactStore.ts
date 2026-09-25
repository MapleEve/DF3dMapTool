import { create } from "zustand";
import type { NearbyInteractor } from "@/engine";

/**
 * F 键交互状态：视口按帧节流上报近旁交互目标（梯子/绳索/滑索/物资 POI），
 * 提示层（RouteHud）与 F 键动作共用；动作由视口直接执行（相机传送/滑行/开物资面板）。
 */
export type InteractTargetKind = "ladder" | "rope" | "zipline" | "poi";

export interface InteractTarget {
  readonly kind: InteractTargetKind;
  /** 物资 POI 显示名（kind=poi 时作提示类型名）。 */
  readonly poiName?: string;
  /** 目标 POI id（kind=poi）。 */
  readonly poiId?: string;
  /** 近旁交互物件（kind≠poi 时 F 键动作参数）。 */
  readonly interactor?: NearbyInteractor;
  /** 到触发点的距离（米）。 */
  readonly distance: number;
}

interface InteractStoreState {
  nearby: InteractTarget | null;
  setNearby: (nearby: InteractTarget | null) => void;
}

export const useInteractStore = create<InteractStoreState>()((set) => ({
  nearby: null,
  setNearby: (nearby) => set({ nearby }),
}));

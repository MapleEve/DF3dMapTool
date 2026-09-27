import { create } from "zustand";

/**
 * 玩法模式状态：当前模式 + 当前图可用模式集。
 *
 * - POI 集按当前模式过滤（poi/filter 的 mode 维度），模式选择入口在大地图；
 * - 可用集随地图数据就绪写入（availableMapModes 派生），换图后当前模式失效时
 *   自动回落到新图的第一个可用模式（上游各图固定单档，正常即等值切换）；
 * - 出生点等模式相关点位集合随过滤自然切换（出生点为 POI 分类之一）。
 */
interface MapModeStoreState {
  /** 当前玩法模式（null = 数据未就绪/不过滤）。 */
  mode: number | null;
  /** 当前图可用模式集（升序；空数组表示数据未就绪）。 */
  availableModes: readonly number[];
  setMode: (mode: number) => void;
  /** 数据就绪/换图时同步可用集；当前模式不在集中时回落到首个可用模式。 */
  applyAvailableModes: (modes: readonly number[]) => void;
  reset: () => void;
}

export const useMapModeStore = create<MapModeStoreState>()((set, get) => ({
  mode: null,
  availableModes: [],
  setMode: (mode) => {
    if (!get().availableModes.includes(mode)) {
      return; // 只允许选择当前图可用模式
    }
    set({ mode });
  },
  applyAvailableModes: (modes) => {
    const unique = [...new Set(modes)].toSorted((a, b) => a - b);
    const current = get().mode;
    const next = current !== null && unique.includes(current) ? current : (unique[0] ?? null);
    set({ availableModes: unique, mode: next });
  },
  reset: () => set({ mode: null, availableModes: [] }),
}));

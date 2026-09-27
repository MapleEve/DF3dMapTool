import type { PoiCategoryId, PoiDefinition } from "./types";

/**
 * POI 过滤状态：隐藏的分类 + 当前楼层 + 玩法模式。
 * floor 为 null 表示不按楼层过滤（俯视全图）；楼层值与数据包 manifest.floors 对齐。
 * mode 为 null 表示不按模式过滤；具体数值与全局模式表（map/mapModes）对齐，
 * 来自数据包 POI 的 mapMode 字段。
 */
export interface PoiFilterState {
  readonly hiddenCategories: readonly PoiCategoryId[];
  readonly floor: number | null;
  /** 玩法模式（POI.meta.mapMode）；null = 不按模式过滤。 */
  readonly mode: number | null;
}

/**
 * 单点判定：
 * - 分类被隐藏 → 不可见；
 * - 有楼层过滤时，POI 楼层须与当前楼层一致；楼层 0 视为“全楼层”，恒可见；
 * - 有模式过滤时，POI 的 mapMode 须与当前模式一致（无模式字段的 POI 不显示）。
 */
export function passesPoiFilter(poi: PoiDefinition, state: PoiFilterState): boolean {
  if (state.hiddenCategories.includes(poi.categoryId)) {
    return false;
  }
  if (state.floor !== null && poi.floor !== 0 && poi.floor !== state.floor) {
    return false;
  }
  if (state.mode !== null && poi.meta?.mapMode !== state.mode) {
    return false;
  }
  return true;
}

export function filterPois(pois: readonly PoiDefinition[], state: PoiFilterState): PoiDefinition[] {
  return pois.filter((poi) => passesPoiFilter(poi, state));
}

/**
 * 数据内可用的玩法模式集（POI.mapMode 去重升序）：
 * 模式选择入口据此呈现——数据包内每图至少有一档（与地图配置的模式集一致）。
 */
export function availableMapModes(pois: readonly PoiDefinition[]): number[] {
  const modes = new Set<number>();
  for (const poi of pois) {
    const mode = poi.meta?.mapMode;
    if (typeof mode === "number") {
      modes.add(mode);
    }
  }
  return [...modes].toSorted((a, b) => a - b);
}

/** 统计各分类在给定楼层与模式下的可见数量（筛选面板角标用）。 */
export function countPoisByCategory(
  pois: readonly PoiDefinition[],
  state: PoiFilterState,
): ReadonlyMap<PoiCategoryId, number> {
  const counts = new Map<PoiCategoryId, number>();
  for (const poi of pois) {
    if (state.floor !== null && poi.floor !== 0 && poi.floor !== state.floor) {
      continue;
    }
    if (state.mode !== null && poi.meta?.mapMode !== state.mode) {
      continue;
    }
    counts.set(poi.categoryId, (counts.get(poi.categoryId) ?? 0) + 1);
  }
  return counts;
}

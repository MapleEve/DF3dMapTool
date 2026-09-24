import type { PoiCategoryId, PoiDefinition } from './types';

/**
 * POI 过滤状态：隐藏的分类 + 当前楼层。
 * floor 为 null 表示不按楼层过滤（俯视全图）；楼层值与数据包 manifest.floors 对齐。
 */
export interface PoiFilterState {
  readonly hiddenCategories: readonly PoiCategoryId[];
  readonly floor: number | null;
}

/**
 * 单点判定：
 * - 分类被隐藏 → 不可见；
 * - 有楼层过滤时，POI 楼层须与当前楼层一致；楼层 0 视为“全楼层”，恒可见。
 */
export function passesPoiFilter(poi: PoiDefinition, state: PoiFilterState): boolean {
  if (state.hiddenCategories.includes(poi.categoryId)) {
    return false;
  }
  if (state.floor !== null && poi.floor !== 0 && poi.floor !== state.floor) {
    return false;
  }
  return true;
}

export function filterPois(pois: readonly PoiDefinition[], state: PoiFilterState): PoiDefinition[] {
  return pois.filter((poi) => passesPoiFilter(poi, state));
}

/** 统计各分类在给定楼层下的可见数量（筛选面板角标用）。 */
export function countPoisByCategory(
  pois: readonly PoiDefinition[],
  state: PoiFilterState,
): ReadonlyMap<PoiCategoryId, number> {
  const counts = new Map<PoiCategoryId, number>();
  for (const poi of pois) {
    if (state.floor !== null && poi.floor !== 0 && poi.floor !== state.floor) {
      continue;
    }
    counts.set(poi.categoryId, (counts.get(poi.categoryId) ?? 0) + 1);
  }
  return counts;
}

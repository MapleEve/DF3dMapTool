import { POI_CATEGORIES } from './categories';

export {
  categoriesFromTypeConfig,
  getPoiCategory,
  isBuiltinPoiCategoryId,
  POI_CATEGORIES,
} from './categories';
export type { PoiTypeConfigLike } from './categories';
export type {
  BuiltinPoiCategoryId,
  PoiCategory,
  PoiCategoryId,
  PoiCategoryLabelKey,
  PoiDefinition,
  PoiSearchable,
} from './types';
export { countPoisByCategory, filterPois, passesPoiFilter, type PoiFilterState } from './filter';
export { normalizeSearchText, searchPois, type RankedMatch } from './search';
/** 内置兜底分类的 ID 列表（“全部隐藏”等批量操作使用）。 */
export const POI_CATEGORY_IDS = POI_CATEGORIES.map((category) => category.id);

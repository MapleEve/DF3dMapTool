import type { PoiCategory, PoiCategoryId } from "./types";

/**
 * 内置兜底分类表（数据包类型配置缺失时使用）。
 * 数据包配置加载后由 categoriesFromTypeConfig 覆盖，order 决定展示顺序。
 */
export const POI_CATEGORIES: readonly PoiCategory[] = [
  { id: "extract", labelKey: "poiCategory.extract", color: "#39d98a", order: 1 },
  { id: "supply", labelKey: "poiCategory.supply", color: "#f5c542", order: 2 },
  { id: "objective", labelKey: "poiCategory.objective", color: "#5aa9ff", order: 3 },
  { id: "landmark", labelKey: "poiCategory.landmark", color: "#b58cff", order: 4 },
  { id: "hazard", labelKey: "poiCategory.hazard", color: "#ff6b6b", order: 5 },
  { id: "spawn", labelKey: "poiCategory.spawn", color: "#8fa3b8", order: 6 },
];

const BUILTIN_CATEGORY_IDS: readonly PoiCategoryId[] = POI_CATEGORIES.map(
  (category) => category.id,
);

/** 数据包分类的主题色调板（按配置顺序取色）。 */
const DATA_CATEGORY_PALETTE = [
  "#f5c542",
  "#ff6b6b",
  "#ff9f43",
  "#b58cff",
  "#8fa3b8",
  "#39d98a",
  "#5aa9ff",
  "#4dd0c4",
  "#e58cc4",
] as const;

/** 数据包类型配置的最小字段集（见 src/data/mapData.ts 的原始形态）。 */
export interface PoiTypeConfigLike {
  readonly TypeId: number;
  readonly Name: string;
  readonly Name_Key?: string;
}

/**
 * 从数据包类型配置派生分类表：id 为 `t<TypeId>`，与 POI 的 categoryId 对齐。
 * 配置内已带显示名（无对应 i18n 键），直接作为 label 兜底。
 */
export function categoriesFromTypeConfig(types: readonly PoiTypeConfigLike[]): PoiCategory[] {
  return types.map((type) => ({
    id: `t${type.TypeId}`,
    label: type.Name,
    color: DATA_CATEGORY_PALETTE[(type.TypeId - 1) % DATA_CATEGORY_PALETTE.length],
    order: type.TypeId,
  }));
}

export function isBuiltinPoiCategoryId(
  value: string,
): value is Exclude<PoiCategoryId, string & {}> {
  return BUILTIN_CATEGORY_IDS.includes(value);
}

export function getPoiCategory(
  id: PoiCategoryId,
  categories?: readonly PoiCategory[],
): PoiCategory | undefined {
  const pool = categories ?? POI_CATEGORIES;
  return pool.find((category) => category.id === id);
}

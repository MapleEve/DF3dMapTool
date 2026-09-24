import type { Vec3 } from "@/common/geometry";
import type { MapId } from "@/map/types";

/**
 * POI 分类 ID。
 * 内置兜底集合为固定字符串；数据包分类（按类型配置派生）形如 `t<TypeId>`，
 * 因此运行时放宽为 string，内置集合仍可用字面量联合约束。
 */
export type BuiltinPoiCategoryId =
  | "extract"
  | "supply"
  | "objective"
  | "landmark"
  | "hazard"
  | "spawn";
export type PoiCategoryId = BuiltinPoiCategoryId | (string & {});

/** 分类显示名的 i18n 键（对应 resources.translation.poiCategory.*）。 */
export type PoiCategoryLabelKey = `poiCategory.${string}`;

/** POI 分类元信息。 */
export interface PoiCategory {
  readonly id: PoiCategoryId;
  /** i18n 键（存在时优先于 label 参与展示）。 */
  readonly labelKey?: PoiCategoryLabelKey;
  /** 数据包提供的显示名（无 i18n 键时的兜底文案）。 */
  readonly label?: string;
  /** 地图/列表中的主题色。 */
  readonly color: string;
  /** 列表展示顺序。 */
  readonly order: number;
}

/** 一个兴趣点的运行时形态。 */
export interface PoiDefinition {
  readonly id: string;
  readonly mapId: MapId;
  /**
   * 楼层归属；0 表示全楼层（各楼层均显示），
   * 具体数值与数据包 manifest.floors 对齐。
   */
  readonly floor: number;
  readonly categoryId: PoiCategoryId;
  /** 展示名（数据包内已本地化的名称）。 */
  readonly displayName: string;
  /** 本地化键（存在时优先于 displayName 参与检索与展示）。 */
  readonly nameKey?: string;
  readonly position: Vec3;
  /** 图标键（对应数据包内图标条目）。 */
  readonly iconKey?: string;
  /** 图标资产在数据包内的路径。 */
  readonly iconFile?: string;
  /** 详情描述（数据包内已本地化）。 */
  readonly description?: string;
  /** 隐藏于 2D 俯视图（跟随数据包配置）。 */
  readonly hiddenInBigmap?: boolean;
  readonly meta?: Readonly<Record<string, string | number>>;
}

/** 检索可用的 POI 形态（id + 参与匹配的文本）。 */
export interface PoiSearchable {
  readonly id: string;
  readonly displayName: string;
  readonly keywords?: readonly string[];
}

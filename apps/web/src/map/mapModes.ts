/**
 * 玩法模式表：与全局模式配置同集合（常规/机密/绝密）。
 * 每张地图的可用模式集由数据包 POI 的 mapMode 字段派生（poi/filter.availableMapModes），
 * 这里只提供全集与显示名键；未收录的模式 id 由调用方走数字兜底显示。
 */

/** 玩法模式定义。 */
export interface MapModeDefinition {
  readonly id: number;
  /** i18n 键（对应 resources.translation.mapMode.*）。 */
  readonly labelKey: `mapMode.${string}`;
  /** 无 i18n 环境时的兜底显示名。 */
  readonly label: string;
}

/** 全局玩法模式全集（id 升序）。 */
export const MAP_MODES: readonly MapModeDefinition[] = [
  { id: 1, labelKey: "mapMode.normal", label: "常规" },
  { id: 2, labelKey: "mapMode.confidential", label: "机密" },
  { id: 3, labelKey: "mapMode.topSecret", label: "绝密" },
];

/** 模式 id → 定义（未收录返回 undefined）。 */
export function getMapModeById(id: number): MapModeDefinition | undefined {
  return MAP_MODES.find((mode) => mode.id === id);
}

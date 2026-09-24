import type { MapCode, MapDefinition, MapId } from "./types";

/**
 * 可切换地图注册表：MapId ↔ 资产代号 ↔ 显示名键。
 * 楼层为静态标定值（2D 楼层配置盘点），运行时以数据包 manifest.floors 为准。
 */
export const MAPS: readonly MapDefinition[] = [
  {
    id: 101,
    code: "damiris",
    nameKey: "maps.damiris",
    knownFloors: [-1, 1, 2],
    defaultFloor: 1,
    bundleUrl: "/assets/damiris/index.dmap",
  },
  {
    id: 102,
    code: "forrest",
    nameKey: "maps.forrest",
    knownFloors: [1],
    defaultFloor: 1,
    bundleUrl: "/assets/forrest/index.dmap",
  },
  {
    id: 104,
    code: "brakkesh",
    nameKey: "maps.brakkesh",
    knownFloors: [1],
    defaultFloor: 1,
    bundleUrl: "/assets/brakkesh/index.dmap",
  },
  {
    id: 105,
    code: "tideprison",
    nameKey: "maps.tideprison",
    knownFloors: [1, 2, 3, 4],
    defaultFloor: 1,
    bundleUrl: "/assets/tideprison/index.dmap",
  },
  {
    id: 106,
    code: "az3",
    nameKey: "maps.az3",
    knownFloors: [1, 2, 3],
    defaultFloor: 1,
    bundleUrl: "/assets/az3/index.dmap",
    knownPlacementCount: 45595,
  },
  {
    id: 203,
    code: "spacecenter",
    nameKey: "maps.spacecenter",
    knownFloors: [1, 2],
    defaultFloor: 1,
    bundleUrl: "/assets/spacecenter/index.dmap",
  },
];

export const MAP_IDS: readonly MapId[] = MAPS.map((map) => map.id);

export const DEFAULT_MAP_ID: MapId = 106;

export function getMapById(id: MapId): MapDefinition | undefined {
  return MAPS.find((map) => map.id === id);
}

export function getMapByCode(code: MapCode): MapDefinition | undefined {
  return MAPS.find((map) => map.code === code);
}

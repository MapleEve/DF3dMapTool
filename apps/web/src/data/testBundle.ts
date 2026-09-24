import { DmapLoader, DmapWriter } from '@df3dmaptool/dmap';
import type { MapId } from '@/map/types';
import { DMAP_KEY_MATERIAL } from '@/engine/dmapKey';
import { MANIFEST_FORMAT, MANIFEST_ENTRY, type MapManifest } from './manifest';

/** 测试用 POI 类型/物品/区域/地图配置与 POI、2D 标定样本。 */
export const FIXTURE_POI = [
  {
    id: 1060206001,
    mapId: 106,
    mapMode: 2,
    itemId: 106001,
    active: 1,
    location: '海边办公楼出生点',
    locationKey: 'LANG_POIConfig_1060206001_Location',
    subTitle: '',
    description: '出生点描述',
    descriptionKey: '',
    floor: 0,
    worldPos: [-1657.2, 0.2, -1859.3],
    icon: 'csd',
    iconFile: 'icons/csd.png',
    hideIn2DMap: 0,
  },
  {
    id: 1060206002,
    mapId: 106,
    mapMode: 2,
    itemId: 106003,
    active: 0,
    location: '停用点',
    locationKey: '',
    subTitle: '',
    description: '',
    descriptionKey: '',
    floor: 1,
    worldPos: [-1700, 0, -1900],
    icon: 'bxx',
    iconFile: 'icons/bxx.png',
    hideIn2DMap: 0,
  },
  {
    id: 1060206003,
    mapId: 106,
    mapMode: 2,
    itemId: 106002,
    active: 1,
    location: '隐藏于俯视图的物资',
    locationKey: '',
    subTitle: '',
    description: '',
    descriptionKey: '',
    floor: 1,
    worldPos: [-1750, 0, -1950],
    icon: 'bxx',
    iconFile: 'icons/bxx.png',
    hideIn2DMap: 1,
  },
];

export const FIXTURE_TYPES = [
  { TypeId: 1, Name: '物资点', Name_Key: 'LANG_POITypeConfig_1_Name' },
  { TypeId: 6, Name: '出生点', Name_Key: 'LANG_POITypeConfig_6_Name' },
];

export const FIXTURE_ITEMS = [
  { Id: 106001, TypeId: 6, Name: '出生点', Quality: 0, Icon: 'csd', HideIn2DMap: 0 },
  { Id: 106002, TypeId: 1, Name: '保险柜', Quality: 6, Icon: 'bxx', HideIn2DMap: 1 },
];

export const FIXTURE_REGIONS = [
  {
    Id: 106001,
    MapId: 106,
    Name: '乏燃料工厂',
    Name_Key: 'LANG_MapRegionConfig_106001_Name',
    WorldPos: [-2448.95, 0, 1918.68],
  },
  {
    Id: 104001,
    MapId: 104,
    Name: '其他地图区域',
    Name_Key: '',
    WorldPos: [0, 0, 0],
  },
];

export const FIXTURE_MAP_CONFIGS = [
  {
    MapId: 106,
    DefaultBornPos: [-2225.77, 4, 1903],
  },
];

export const FIXTURE_MAP2D = {
  mapCode: 'az3',
  mapId: 106,
  sceneBounds: { min: [-3195.854, -78.827, -2872.943], max: [-707.463, 203.294, -1280.274] },
  floors: [
    {
      floorName: 'AZ3',
      worldMinXZ: { x: -2761.5, z: -2757.6 },
      worldMaxXZ: { x: -1423.98, z: -1489.96 },
      playableRectPx: { x: 257, y: 826, width: 3370, height: 3195 },
      pixelW: 4096,
      pixelH: 4096,
      image: 'minimap/az3.png',
      imageSize: [2048, 2048] as const,
    },
    {
      floorName: 'AZ3_1f',
      worldMinXZ: { x: -2761.5, z: -2757.6 },
      worldMaxXZ: { x: -1423.98, z: -1489.96 },
      playableRectPx: { x: 257, y: 826, width: 3370, height: 3195 },
      pixelW: 4096,
      pixelH: 4096,
      image: 'minimap/az3_1f.png',
      imageSize: [2048, 2048] as const,
    },
  ],
};

export function fixtureManifest(mapId: MapId = 106): MapManifest {
  return {
    format: MANIFEST_FORMAT,
    map: { mapId, code: 'az3' },
    floors: [1, 2, 3],
    containers: ['az3.dmap'],
    entries: {
      scene: 'maps/az3/scene.json',
      poi: 'maps/az3/poi.json',
      map2d: 'maps/az3/map2d.json',
      configs: [
        'configs/map_config.json',
        'configs/poi_type_config.json',
        'configs/poi_item_config.json',
        'configs/map_region_config.json',
      ],
      icons: 'icons/index.json',
      minimaps: 'minimap/index.json',
    },
    counts: { chunks: 1, instances: 2, vertices: 10, triangles: 8, geometries: 1 },
    chunkBounds: [],
  };
}

const PNG_1PX = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

/** 构建一个最小可用的 .dmap 容器（含全部测试配置条目）。 */
export async function buildFixtureBundleBytes(mapId: MapId = 106): Promise<Uint8Array> {
  const writer = DmapWriter.create()
    .addJson(MANIFEST_ENTRY, fixtureManifest(mapId))
    .addJson('maps/az3/poi.json', FIXTURE_POI)
    .addJson('maps/az3/scene.json', { mapCode: 'az3', mapId, floorValues: [1, 2, 3] })
    .addJson('maps/az3/map2d.json', FIXTURE_MAP2D)
    .addJson('configs/map_config.json', FIXTURE_MAP_CONFIGS)
    .addJson('configs/poi_type_config.json', FIXTURE_TYPES)
    .addJson('configs/poi_item_config.json', FIXTURE_ITEMS)
    .addJson('configs/map_region_config.json', FIXTURE_REGIONS)
    .addJson('icons/index.json', { csd: { file: 'icons/csd.png', width: 8, height: 8 } })
    .addJson('minimap/index.json', [{ name: 'az3', width: 2048, height: 2048, file: 'minimap/az3.png' }])
    .add('icons/csd.png', 'image/png', PNG_1PX);
  return writer.write(DMAP_KEY_MATERIAL);
}

/** 打开测试容器。 */
export async function openFixtureBundle(mapId: MapId = 106): Promise<DmapLoader> {
  const bytes = await buildFixtureBundleBytes(mapId);
  return DmapLoader.open(bytes, DMAP_KEY_MATERIAL);
}

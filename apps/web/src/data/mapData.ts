import type { DmapLoader } from '@df3dmaptool/dmap';
import { categoriesFromTypeConfig } from '@/poi/categories';
import type { PoiCategory, PoiDefinition } from '@/poi/types';
import type { Vec3 } from '@/common/geometry';
import type { MapBundle } from './manifest';

/**
 * 数据包 → 运行时视图数据的派生层。
 *
 * 世界系口径（全应用统一为“管线世界系”：右手、Y 向上、源数据已做 Z 镜像）：
 * - 数据包内 POI 坐标与 2D 楼层标定（map2d.json）已是管线世界系，直接使用；
 * - 配置表（区域表 / 出生点）为源世界系（Z 未镜像），此处统一做 z → −z 归一。
 */

/** poi.json 的原始条目形态。 */
export interface RawPoi {
  readonly id: number;
  readonly mapId: number;
  readonly mapMode: number;
  readonly itemId: number;
  readonly active: number;
  readonly location: string;
  readonly locationKey: string;
  readonly subTitle: string;
  readonly description: string;
  readonly descriptionKey: string;
  readonly floor: number;
  readonly worldPos: readonly [number, number, number];
  readonly icon: string;
  readonly iconFile: string;
  readonly hideIn2DMap: number;
}

/** 类型/物品/区域配置表的原始形态（仅取 UI 需要的字段）。 */
export interface RawPoiType {
  readonly TypeId: number;
  readonly Name: string;
  readonly Name_Key: string;
}

export interface RawPoiItem {
  readonly Id: number;
  readonly TypeId: number;
  readonly Name: string;
  readonly Quality: number;
  readonly Icon: string;
  readonly HideIn2DMap: number;
}

export interface RawMapRegion {
  readonly Id: number;
  readonly MapId: number;
  readonly Name: string;
  readonly Name_Key: string;
  readonly WorldPos: readonly [number, number, number];
}

/** map2d.json 的原始形态（每图一份，含每楼层标定）。 */
export interface RawMap2dFloor {
  readonly floorName: string;
  readonly worldMinXZ: { readonly x: number; readonly z: number };
  readonly worldMaxXZ: { readonly x: number; readonly z: number };
  readonly playableRectPx: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly pixelW: number;
  readonly pixelH: number;
  readonly image: string;
  readonly imageSize: readonly [number, number];
}

export interface RawMap2d {
  readonly mapCode: string;
  readonly mapId: number;
  readonly sceneBounds: { readonly min: readonly number[]; readonly max: readonly number[] };
  readonly floors: readonly RawMap2dFloor[];
}

export interface RawMinimapInfo {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly file: string;
}

export interface RawMapConfigEntry {
  readonly MapId: number;
  readonly DefaultBornPos?: readonly [number, number, number];
}

/** 区域标注（管线世界系）。 */
export interface MapRegion {
  readonly id: string;
  readonly name: string;
  readonly nameKey?: string;
  readonly position: Vec3;
}

/** 数据包派生出的全部 UI 视图数据。 */
export interface MapPoiData {
  readonly mapId: number;
  readonly mapCode: string;
  readonly pois: readonly PoiDefinition[];
  readonly categories: readonly PoiCategory[];
  readonly regions: readonly MapRegion[];
  readonly map2d: RawMap2d;
  /** 场景包围盒（管线世界系），用于相机取景。 */
  readonly sceneBounds: { readonly min: Vec3; readonly max: Vec3 };
  /** 默认出生点（管线世界系；缺失为 null）。 */
  readonly defaultBornPos: Vec3 | null;
  readonly iconIndex: Readonly<Record<string, { readonly file: string; readonly width: number; readonly height: number }>>;
  readonly minimapIndex: readonly RawMinimapInfo[];
}

/** 全楼层 POI 的楼层占位值（各楼层均显示）。 */
export const POI_ALL_FLOORS = 0;

function asVec3(values: readonly number[]): Vec3 {
  return { x: values[0] ?? 0, y: values[1] ?? 0, z: values[2] ?? 0 };
}

/** 配置表源世界系坐标 → 管线世界系（z 镜像）。 */
export function toPipelineWorld(values: readonly number[]): Vec3 {
  return { x: values[0] ?? 0, y: values[1] ?? 0, z: -(values[2] ?? 0) };
}

/** 从数据包读取并派生全部 UI 视图数据（同步、纯内存）。 */
export function readMapPoiData(bundle: MapBundle): MapPoiData {
  const { loader, manifest, definition } = bundle;
  const rawPois = loader.readJson<RawPoi[]>(manifest.entries.poi);
  const types = loader.readJson<RawPoiType[]>('configs/poi_type_config.json');
  const items = loader.readJson<RawPoiItem[]>('configs/poi_item_config.json');
  const regions = loader.readJson<RawMapRegion[]>('configs/map_region_config.json');
  const mapConfigs = loader.readJson<RawMapConfigEntry[]>('configs/map_config.json');
  const map2d = loader.readJson<RawMap2d>(manifest.entries.map2d);
  const minimapIndex = loader.readJson<RawMinimapIndex>(manifest.entries.minimaps);
  const iconIndex = loader.readJson<RawIconIndex>(manifest.entries.icons);

  const itemById = new Map(items.map((item) => [item.Id, item]));
  const categories = categoriesFromTypeConfig(types);

  const pois: PoiDefinition[] = [];
  for (const raw of rawPois) {
    if (raw.active !== 1) {
      continue;
    }
    const item = itemById.get(raw.itemId);
    pois.push({
      id: String(raw.id),
      mapId: definition.id,
      floor: raw.floor,
      categoryId: item !== undefined ? `t${item.TypeId}` : 'landmark',
      displayName: raw.location,
      nameKey: raw.locationKey || undefined,
      position: asVec3(raw.worldPos),
      iconKey: raw.icon || item?.Icon || undefined,
      iconFile: raw.iconFile || undefined,
      description: raw.description || undefined,
      hiddenInBigmap: raw.hideIn2DMap === 1 || item?.HideIn2DMap === 1,
      meta: {
        itemId: raw.itemId,
        mapMode: raw.mapMode,
        quality: item?.Quality ?? 0,
        itemName: item?.Name ?? '',
      },
    });
  }

  const mapRegions = regions
    .filter((region) => region.MapId === definition.id)
    .map((region) => ({
      id: String(region.Id),
      name: region.Name,
      nameKey: region.Name_Key || undefined,
      position: toPipelineWorld(region.WorldPos),
    }));

  const mapConfig = mapConfigs.find((entry) => entry.MapId === definition.id) ?? null;
  const bornRaw = mapConfig?.DefaultBornPos;
  const fallbackBorn = map2d.sceneBounds
    ? {
        x: (map2d.sceneBounds.min[0] + map2d.sceneBounds.max[0]) / 2,
        y: 0,
        z: (map2d.sceneBounds.min[2] + map2d.sceneBounds.max[2]) / 2,
      }
    : null;

  return {
    mapId: definition.id,
    mapCode: definition.code,
    pois,
    categories,
    regions: mapRegions,
    map2d,
    sceneBounds: { min: asVec3(map2d.sceneBounds.min), max: asVec3(map2d.sceneBounds.max) },
    defaultBornPos: bornRaw !== undefined ? toPipelineWorld(bornRaw) : fallbackBorn,
    iconIndex,
    minimapIndex,
  };
}

interface RawIconIndex {
  readonly [iconKey: string]: { readonly file: string; readonly width: number; readonly height: number };
}
type RawMinimapIndex = readonly RawMinimapInfo[];

const iconUrlCaches = new WeakMap<DmapLoader, Map<string, string>>();

/**
 * 读取数据包内图标为 object URL（按加载器缓存，调用方持有至不再使用）。
 * 路径缺失或读取失败返回 undefined，由调用方走占位渲染。
 */
export function getIconObjectUrl(loader: DmapLoader, iconFile: string): string | undefined {
  let cache = iconUrlCaches.get(loader);
  if (cache === undefined) {
    cache = new Map();
    iconUrlCaches.set(loader, cache);
  }
  const cached = cache.get(iconFile);
  if (cached !== undefined) {
    return cached;
  }
  if (!loader.has(iconFile)) {
    return undefined;
  }
  try {
    const bytes = loader.read(iconFile);
    const url = URL.createObjectURL(
      new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' }),
    );
    cache.set(iconFile, url);
    return url;
  } catch {
    return undefined;
  }
}

/**
 * 楼层 → 俯视底图条目解析。
 * floor 为 null 表示“全图”概览（floorName 无楼层后缀的整图）；否则匹配 `_Nf` 后缀
 * （地下层为负数，后缀形如 `_-1f`），匹配不到时回退整图。返回 null 表示没有可用底图。
 */
export function resolveFloorEntry(map2d: RawMap2d, floor: number | null): RawMap2dFloor | null {
  const overview = map2d.floors.find((entry) => !/_-?\d+f$/i.test(entry.floorName)) ?? null;
  if (floor === null) {
    return overview;
  }
  const suffix = new RegExp(`_${floor}f$`, 'i');
  return map2d.floors.find((entry) => suffix.test(entry.floorName)) ?? overview;
}

/** 楼层条目 → 底图对象 URL 读取所需的路径与尺寸。 */
export function floorImageInfo(entry: RawMap2dFloor): {
  readonly file: string;
  readonly width: number;
  readonly height: number;
} {
  return { file: entry.image, width: entry.imageSize[0], height: entry.imageSize[1] };
}

/** 楼层标定 → 2D 投影标定（结构对齐 BigmapCalibration 字段）。 */
export function floorCalibration(
  floorConfig: RawMap2dFloor,
): {
  worldMinX: number;
  worldMaxX: number;
  worldMinZ: number;
  worldMaxZ: number;
  imageWidthPx: number;
  imageHeightPx: number;
} {
  return {
    worldMinX: floorConfig.worldMinXZ.x,
    worldMaxX: floorConfig.worldMaxXZ.x,
    worldMinZ: floorConfig.worldMinXZ.z,
    worldMaxZ: floorConfig.worldMaxXZ.z,
    imageWidthPx: floorConfig.pixelW,
    imageHeightPx: floorConfig.pixelH,
  };
}

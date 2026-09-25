import { AssetFetchError, openMapBundle } from "@/engine/assets";
import type { MapCode } from "@/map/types";
import type { Vec3 } from "@/common/geometry";

/**
 * 路线 / 交互物件 / 收藏数据（Batch4 数据容器）。
 *
 * 容器布局（管线 pack_batch4.mjs 产物）：
 * - /assets/<code>/routes.dmap：routes.json（热门路线，df3d-routes/1）+ interactors.json（F 键交互物件）
 * - /assets/collection.dmap：collection_config.json + poi_collection_config.json + poi_collection_map.json
 *
 * 坐标均为管线世界系（右手、Y 向上、源数据已 Z 镜像）。
 */

export const ROUTES_FORMAT = "df3d-routes/1";
export const INTERACTORS_FORMAT = "df3d-interactors/1";
export const COLLECTION_FORMAT = "df3d-collection/1";
export const COLLECTION_ROLLS_FORMAT = "df3d-collection-rolls/1";
export const COLLECTION_MAP_FORMAT = "df3d-collection-map/1";

/** 路线标注点。 */
export interface RouteMarker {
  readonly name: string;
  readonly nameEn: string | null;
  readonly desc: string;
  readonly descEn: string;
  readonly pointIndex: number;
  readonly worldPos: Vec3;
  readonly nearestDistance: number;
}

/** 一条热门路线（点位为 float32 xyz 的 base64，管线世界系）。 */
export interface RouteDefinition {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string | null;
  readonly hotScore: number;
  readonly durationSeconds: number;
  readonly lengthMeters: number;
  readonly startIndex: number;
  readonly pointCount: number;
  readonly pointsB64: string;
  readonly markers: readonly RouteMarker[];
}

export interface RoutesDoc {
  readonly format: string;
  readonly mapCode: string;
  readonly mapId: number;
  readonly routes: readonly RouteDefinition[];
}

/** 容器内路线表的原始形态（标注点坐标为 [x,y,z] 三元组）。 */
interface RawRoutesDoc {
  readonly format: string;
  readonly mapCode: string;
  readonly mapId: number;
  readonly routes: readonly {
    readonly id: string;
    readonly name: string;
    readonly nameEn: string | null;
    readonly hotScore: number;
    readonly durationSeconds: number;
    readonly lengthMeters: number;
    readonly startIndex: number;
    readonly pointCount: number;
    readonly pointsB64: string;
    readonly markers: readonly {
      readonly name: string;
      readonly nameEn: string | null;
      readonly desc: string;
      readonly descEn: string;
      readonly pointIndex: number;
      readonly worldPos: readonly number[];
      readonly nearestDistance: number;
    }[];
  }[];
}

/** F 键交互物件（梯子/绳索/滑索）。 */
export interface LadderInteractor {
  readonly top: Vec3;
  readonly bottom: Vec3;
  readonly facingDirection: number;
}

export interface RopeInteractor {
  readonly top: Vec3;
  readonly bottom: Vec3;
}

export interface ZiplineInteractor {
  readonly a: Vec3;
  readonly b: Vec3;
  readonly interactionRadius: number;
  readonly slideSpeed: number;
  readonly canExitInSliding: boolean;
}

export interface InteractorsDoc {
  readonly format: string;
  readonly mapCode: string;
  readonly mapId: number;
  readonly ladders: readonly LadderInteractor[];
  readonly ropes: readonly RopeInteractor[];
  readonly ziplines: readonly ZiplineInteractor[];
}

/** 容器内交互物件的原始形态（坐标为 [x,y,z] 三元组）。 */
interface RawInteractorsDoc {
  readonly format: string;
  readonly mapCode: string;
  readonly mapId: number;
  readonly ladders: readonly {
    readonly top: readonly number[];
    readonly bottom: readonly number[];
    readonly facingDirection: number;
  }[];
  readonly ropes: readonly {
    readonly top: readonly number[];
    readonly bottom: readonly number[];
  }[];
  readonly ziplines: readonly {
    readonly a: readonly number[];
    readonly b: readonly number[];
    readonly interactionRadius: number;
    readonly slideSpeed: number;
    readonly canExitInSliding: number;
  }[];
}

function toInteractorsDoc(raw: RawInteractorsDoc): InteractorsDoc {
  return {
    format: raw.format,
    mapCode: raw.mapCode,
    mapId: raw.mapId,
    ladders: raw.ladders.map((entry) => ({
      top: asVec3(entry.top),
      bottom: asVec3(entry.bottom),
      facingDirection: entry.facingDirection,
    })),
    ropes: raw.ropes.map((entry) => ({ top: asVec3(entry.top), bottom: asVec3(entry.bottom) })),
    ziplines: raw.ziplines.map((entry) => ({
      a: asVec3(entry.a),
      b: asVec3(entry.b),
      interactionRadius: entry.interactionRadius,
      slideSpeed: entry.slideSpeed,
      canExitInSliding: entry.canExitInSliding === 1,
    })),
  };
}

/** 收藏（物资）条目；源数据无交易价值字段（估值如实呈现为缺失）。 */
export interface CollectionItem {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string | null;
  readonly quality: number;
  readonly subTitle: string;
  readonly description: string;
}

export interface CollectionRoll {
  readonly id: number;
  readonly rollCollections: readonly string[];
  readonly rollWeights: readonly number[];
  readonly rollMaxNumber: number;
}

export interface CollectionData {
  readonly items: readonly CollectionItem[];
  readonly itemById: ReadonlyMap<string, CollectionItem>;
  readonly rollById: ReadonlyMap<number, CollectionRoll>;
  readonly poiRollId: ReadonlyMap<string, number>;
}

/** 路线点位解码：base64 float32 → xyz 三元组序列。 */
export function decodeRoutePoints(pointsB64: string): Float32Array {
  const raw = atob(pointsB64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

/** 按下标取点位。 */
export function routePointAt(points: Float32Array, index: number): Vec3 {
  const i = index * 3;
  return { x: points[i] ?? 0, y: points[i + 1] ?? 0, z: points[i + 2] ?? 0 };
}

/** 数据包原始三元组 → Vec3。 */
function asVec3(values: readonly number[]): Vec3 {
  return { x: values[0] ?? 0, y: values[1] ?? 0, z: values[2] ?? 0 };
}

/** 路线数据加载失败的对外形态（数据未随应用分发是常态：az3 等图无数据）。 */
export type RouteLoadErrorCode = "unavailable" | "unknown";

export class RoutesUnavailableError extends Error {
  constructor(url: string) {
    super(`路线数据未随应用分发: ${url}`);
    this.name = "RoutesUnavailableError";
  }
}

export function routeLoadErrorCode(error: unknown): RouteLoadErrorCode {
  if (error instanceof RoutesUnavailableError || error instanceof AssetFetchError) {
    return "unavailable";
  }
  return "unknown";
}

interface CacheEntry<T> {
  promise: Promise<T>;
}

const cache = new Map<string, CacheEntry<unknown>>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit !== undefined) {
    return hit.promise as Promise<T>;
  }
  const promise = load().catch((error: unknown) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { promise });
  return promise;
}

/** 清空缓存（测试隔离用）。 */
export function resetRouteDataCache(): void {
  cache.clear();
}

async function readEntry<T>(url: string, entry: string): Promise<T> {
  let loader;
  try {
    loader = await openMapBundle(url);
  } catch (error) {
    if (error instanceof AssetFetchError) {
      throw new RoutesUnavailableError(url);
    }
    throw error;
  }
  return loader.readJson<T>(entry);
}

/** 加载一张地图的热门路线表；未分发（404）抛 RoutesUnavailableError。 */
export function loadRoutes(mapCode: MapCode): Promise<RoutesDoc> {
  return cached(`routes:${mapCode}`, async () => {
    const raw = await readEntry<RawRoutesDoc>(`/assets/${mapCode}/routes.dmap`, "routes.json");
    if (raw.format !== ROUTES_FORMAT) {
      throw new RangeError(`路线数据 format 应为 ${ROUTES_FORMAT}`);
    }
    if (raw.mapCode !== mapCode) {
      throw new RangeError(`路线数据地图 (${raw.mapCode}) 与请求地图 (${mapCode}) 不一致`);
    }
    return {
      format: raw.format,
      mapCode: raw.mapCode,
      mapId: raw.mapId,
      routes: raw.routes.map((route) => ({
        ...route,
        markers: route.markers.map((marker) => ({
          ...marker,
          worldPos: asVec3(marker.worldPos),
        })),
      })),
    };
  });
}

/** 加载一张地图的交互物件表；未分发（404）抛 RoutesUnavailableError。 */
export function loadInteractors(mapCode: MapCode): Promise<InteractorsDoc> {
  return cached(`interactors:${mapCode}`, async () => {
    const raw = await readEntry<RawInteractorsDoc>(
      `/assets/${mapCode}/routes.dmap`,
      "interactors.json",
    );
    if (raw.format !== INTERACTORS_FORMAT) {
      throw new RangeError(`交互物件数据 format 应为 ${INTERACTORS_FORMAT}`);
    }
    if (raw.mapCode !== mapCode) {
      throw new RangeError(`交互物件数据地图 (${raw.mapCode}) 与请求地图 (${mapCode}) 不一致`);
    }
    return toInteractorsDoc(raw);
  });
}

interface RawCollectionConfig {
  readonly format: string;
  readonly items: readonly {
    readonly id: string;
    readonly name: string;
    readonly nameEn: string | null;
    readonly quality: number;
    readonly subTitle: string;
    readonly description: string;
  }[];
}

interface RawRollConfig {
  readonly format: string;
  readonly rolls: readonly {
    readonly id: number;
    readonly rollCollections: readonly string[];
    readonly rollWeights: readonly number[];
    readonly rollMaxNumber: number;
  }[];
}

interface RawPoiMap {
  readonly format: string;
  readonly poiToRoll: Readonly<Record<string, number>>;
}

/** 加载共享收藏数据（全图共用一份容器）；解析结果派生索引表。 */
export function loadCollectionData(): Promise<CollectionData> {
  return cached("collection", async () => {
    const config = await readEntry<RawCollectionConfig>(
      "/assets/collection.dmap",
      "collection_config.json",
    );
    if (config.format !== COLLECTION_FORMAT) {
      throw new RangeError(`收藏数据 format 应为 ${COLLECTION_FORMAT}`);
    }
    const rollsDoc = await readEntry<RawRollConfig>(
      "/assets/collection.dmap",
      "poi_collection_config.json",
    );
    if (rollsDoc.format !== COLLECTION_ROLLS_FORMAT) {
      throw new RangeError(`收藏 roll 表 format 应为 ${COLLECTION_ROLLS_FORMAT}`);
    }
    const mapDoc = await readEntry<RawPoiMap>("/assets/collection.dmap", "poi_collection_map.json");
    if (mapDoc.format !== COLLECTION_MAP_FORMAT) {
      throw new RangeError(`收藏映射 format 应为 ${COLLECTION_MAP_FORMAT}`);
    }
    const items: CollectionItem[] = config.items.map((item) => ({
      id: item.id,
      name: item.name,
      nameEn: item.nameEn,
      quality: item.quality,
      subTitle: item.subTitle,
      description: item.description,
    }));
    const rolls: CollectionRoll[] = rollsDoc.rolls.map((roll) => ({
      id: roll.id,
      rollCollections: roll.rollCollections,
      rollWeights: roll.rollWeights,
      rollMaxNumber: roll.rollMaxNumber,
    }));
    return {
      items,
      itemById: new Map(items.map((item) => [item.id, item])),
      rollById: new Map(rolls.map((roll) => [roll.id, roll])),
      poiRollId: new Map(
        Object.entries(mapDoc.poiToRoll).map(([poiId, rollId]) => [poiId, rollId]),
      ),
    };
  });
}

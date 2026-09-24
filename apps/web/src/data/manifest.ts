import type { DmapLoader } from '@df3dmaptool/dmap';
import type { MapDefinition } from '@/map/types';

/**
 * 数据包内 manifest.json 的结构（dmap-map-manifest/2）。
 * 清单是全部内置地图的索引：`maps` 数组每个条目描述一张图（floors/counts/containers），
 * 其中“本容器承载”的那张图额外携带 `entries`（各类资产的包内路径）与
 * `chunkBounds`（3D 分块包围盒，供引擎按需加载与 UI 取景使用）。
 */
export const MANIFEST_FORMAT = 'dmap-map-manifest/2';

/** 索引中一张地图的条目。 */
export interface MapIndexEntry {
  readonly mapId: number;
  readonly code: string;
  /** 楼层列表（升序）。 */
  readonly floors: readonly number[];
  readonly containers: readonly string[];
  readonly counts: ManifestCounts;
  /** 本容器承载的地图才携带：资产路径表。 */
  readonly entries?: ManifestEntries;
  /** 本容器承载的地图才携带：3D 分块描述。 */
  readonly chunkBounds?: readonly MapChunkBounds[];
}

/** 各类资产的包内路径。 */
export interface ManifestEntries {
  readonly scene: string;
  readonly poi: string;
  readonly map2d: string;
  readonly configs: readonly string[];
  readonly icons: string;
  readonly minimaps: string;
}

/** 一张图的数据规模。 */
export interface ManifestCounts {
  readonly chunks: number;
  readonly instances: number;
  readonly vertices: number;
  readonly triangles: number;
  readonly geometries: number;
  readonly pois: number;
}

/** 一个 3D 分块的规模与包围盒（管线世界系）。 */
export interface MapChunkBounds {
  readonly id: string;
  readonly file: string;
  readonly container: number;
  readonly instances: number;
  readonly vertices: number;
  readonly triangles: number;
  readonly geometries: number;
  readonly bytes: number;
  readonly bytesCompressed: number;
  readonly boundsMin: readonly [number, number, number];
  readonly boundsMax: readonly [number, number, number];
}

/** 容器内 manifest.json 的原始形态（全部地图的索引）。 */
export interface MapManifestIndex {
  readonly format: string;
  readonly maps: readonly MapIndexEntry[];
}

/**
 * 解析后的单图清单视图：从索引中取出当前地图条目并补全为完整形态，
 * 与 dmap-map-manifest/1 时代的结构保持同构，供数据层与 UI 直接消费。
 */
export interface MapManifest {
  readonly format: string;
  readonly map: {
    readonly mapId: number;
    readonly code: string;
  };
  readonly floors: readonly number[];
  readonly containers: readonly string[];
  readonly entries: ManifestEntries;
  readonly counts: ManifestCounts;
  readonly chunkBounds: readonly MapChunkBounds[];
}

/** 加载完成的地图数据包：定义 + 解析后的单图清单 + 已通过完整性校验的加载器。 */
export interface MapBundle {
  readonly definition: MapDefinition;
  readonly manifest: MapManifest;
  readonly loader: DmapLoader;
}

/** manifest 在包内的固定条目名。 */
export const MANIFEST_ENTRY = 'manifest.json';

/**
 * 从索引解析指定地图的单图视图；结构不合法时抛 RangeError。
 * 仅本容器承载的地图才携带 entries/chunkBounds，其余条目只是索引摘要。
 */
export function resolveMapManifest(index: MapManifestIndex, mapId: number): MapManifest {
  if (index.format !== MANIFEST_FORMAT) {
    throw new RangeError(`manifest 格式不支持: ${index.format}`);
  }
  if (!Array.isArray(index.maps) || index.maps.length === 0) {
    throw new RangeError('manifest.maps 不能为空');
  }
  const entry = index.maps.find((item) => item.mapId === mapId);
  if (entry === undefined) {
    throw new RangeError(`manifest.maps 中不存在地图 ${mapId}`);
  }
  if (entry.code.length === 0) {
    throw new RangeError(`地图 ${mapId} 的 code 缺失`);
  }
  if (!Array.isArray(entry.floors) || entry.floors.length === 0) {
    throw new RangeError(`地图 ${mapId} 的 floors 不能为空`);
  }
  if (!Array.isArray(entry.containers) || entry.containers.length === 0) {
    throw new RangeError(`地图 ${mapId} 的 containers 不能为空`);
  }
  if (entry.entries === undefined || entry.chunkBounds === undefined) {
    throw new RangeError(`本容器不承载地图 ${mapId} 的数据`);
  }
  if (!Array.isArray(entry.chunkBounds) || entry.chunkBounds.length === 0) {
    throw new RangeError(`地图 ${mapId} 的 chunkBounds 不能为空`);
  }
  return {
    format: index.format,
    map: { mapId: entry.mapId, code: entry.code },
    floors: entry.floors,
    containers: entry.containers,
    entries: entry.entries,
    counts: entry.counts,
    chunkBounds: entry.chunkBounds,
  };
}

import { DmapError, DmapMapPackage, type DmapMapManifest } from "@df3dmaptool/dmap";
import { DMAP_KEY_MATERIAL } from "@/engine/dmapKey";
import { containerFetcher } from "@/engine/assets";
import { getMapById } from "@/map/registry";
import type { MapDefinition, MapId } from "@/map/types";

/** 面向 UI 的加载失败归类。 */
export type MapLoadErrorCode = "unavailable" | "corrupt" | "unknown";

export class MapDataUnavailableError extends Error {
  readonly mapId: MapId;

  constructor(mapId: MapId) {
    super(`地图数据包不可用: ${mapId}`);
    this.name = "MapDataUnavailableError";
    this.mapId = mapId;
  }
}

export class MapDataCorruptError extends Error {
  readonly mapId: MapId;

  constructor(mapId: MapId, cause?: unknown) {
    super(`地图数据包校验失败: ${mapId}`);
    this.name = "MapDataCorruptError";
    this.mapId = mapId;
    this.cause = cause;
  }
}

export function mapLoadErrorCode(error: unknown): MapLoadErrorCode {
  if (error instanceof MapDataUnavailableError) {
    return "unavailable";
  }
  if (error instanceof MapDataCorruptError) {
    return "corrupt";
  }
  return "unknown";
}

/**
 * 索引容器下载进度回调：fraction ∈ [0, 1]。
 * 分片布局下索引只有几 MB，下载完成即 UI 就绪；3D 分块由引擎按需并行拉取，
 * 不在本回调的进度内。
 */
export type LoadProgressCallback = (fraction: number) => void;

/** 加载完成的地图数据包：定义 + 清单 + 分片包加载器（索引已开，分块惰性）。 */
export interface MapBundle {
  readonly definition: MapDefinition;
  readonly manifest: DmapMapManifest;
  /** 分片数据包（索引容器已打开；分块容器按清单惰性拉取）。 */
  readonly pkg: DmapMapPackage;
}

/** 同一地图的加载结果按 mapId 复用（并发与重复调用共享同一次网络请求）。 */
const bundleCache = new Map<MapId, Promise<MapBundle>>();

/** 清空加载缓存（测试隔离用）。 */
export function resetBundleCache(): void {
  bundleCache.clear();
}

/**
 * 拉取并校验一张地图的数据包（两段式的第一段：仅索引容器）。
 *
 * 失败归类：资源缺失/网络不可达 → MapDataUnavailableError；
 * 容器校验/清单不合法 → MapDataCorruptError；其余原样抛出。
 * 索引就绪即可派生 POI/2D/配置数据渲染 UI，3D 分块由引擎层按需加载。
 */
export function loadMapBundle(mapId: MapId, onProgress?: LoadProgressCallback): Promise<MapBundle> {
  const cached = bundleCache.get(mapId);
  if (cached !== undefined) {
    // 缓存命中：容器已在本地，直接把下载进度报到完成。
    if (onProgress !== undefined) {
      void cached.then(
        () => onProgress(1),
        () => undefined,
      );
    }
    return cached;
  }
  const pending = doLoadMapBundle(mapId, onProgress);
  bundleCache.set(mapId, pending);
  pending.catch(() => {
    bundleCache.delete(mapId);
  });
  return pending;
}

async function doLoadMapBundle(
  mapId: MapId,
  onProgress?: LoadProgressCallback,
): Promise<MapBundle> {
  const definition = getMapById(mapId);
  if (definition === undefined) {
    throw new RangeError(`未知地图: ${mapId}`);
  }

  // 第一步只拉索引容器：清单 + POI/配置/图标/2D 标定，几 MB 即 UI 就绪。
  const bytes = await fetchIndex(mapId, definition.bundleUrl, onProgress);

  let pkg: DmapMapPackage;
  try {
    pkg = await DmapMapPackage.openIndex(bytes, DMAP_KEY_MATERIAL, {
      fetchContainer: containerFetcher(definition.bundleUrl),
    });
  } catch (error) {
    if (error instanceof DmapError) {
      throw new MapDataCorruptError(mapId, error);
    }
    throw error;
  }

  if (pkg.manifest.map.mapId !== mapId) {
    throw new MapDataCorruptError(
      mapId,
      new RangeError(`数据包地图 (${pkg.manifest.map.mapId}) 与请求地图 (${mapId}) 不一致`),
    );
  }
  onProgress?.(1);
  return { definition, manifest: pkg.manifest, pkg };
}

async function fetchIndex(
  mapId: MapId,
  url: string,
  onProgress?: LoadProgressCallback,
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new MapDataUnavailableError(mapId);
  }
  if (!response.ok) {
    throw new MapDataUnavailableError(mapId);
  }
  if (onProgress === undefined || !response.body) {
    return new Uint8Array(await response.arrayBuffer());
  }

  const totalHeader = response.headers.get("content-length");
  const total = totalHeader === null ? Number.NaN : Number(totalHeader);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastReported = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      if (Number.isFinite(total) && total > 0) {
        onProgress(Math.min(0.95, received / total));
      } else {
        // 无 Content-Length：以 8MB 经验规模给出平滑的参考进度（索引容器量级）。
        lastReported = Math.min(0.95, lastReported + value.byteLength / (8 * 1024 * 1024));
        onProgress(Math.max(lastReported, 0.05));
      }
    }
  }

  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

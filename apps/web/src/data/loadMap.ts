import { DmapError, DmapLoader } from '@df3dmaptool/dmap';
import { DMAP_KEY_MATERIAL } from '@/engine/dmapKey';
import { getMapById } from '@/map/registry';
import type { MapId } from '@/map/types';
import { MANIFEST_ENTRY, MANIFEST_FORMAT, type MapBundle, type MapManifest } from './manifest';

/** 面向 UI 的加载失败归类。 */
export type MapLoadErrorCode = 'unavailable' | 'corrupt' | 'unknown';

export class MapDataUnavailableError extends Error {
  readonly mapId: MapId;

  constructor(mapId: MapId) {
    super(`地图数据包不可用: ${mapId}`);
    this.name = 'MapDataUnavailableError';
    this.mapId = mapId;
  }
}

export class MapDataCorruptError extends Error {
  readonly mapId: MapId;

  constructor(mapId: MapId, cause?: unknown) {
    super(`地图数据包校验失败: ${mapId}`);
    this.name = 'MapDataCorruptError';
    this.mapId = mapId;
    this.cause = cause;
  }
}

export function mapLoadErrorCode(error: unknown): MapLoadErrorCode {
  if (error instanceof MapDataUnavailableError) {
    return 'unavailable';
  }
  if (error instanceof MapDataCorruptError) {
    return 'corrupt';
  }
  return 'unknown';
}

/** 下载进度回调：fraction ∈ [0, 1]，下载阶段最高报到 0.95，容器校验完成报 1。 */
export type LoadProgressCallback = (fraction: number) => void;

function validateManifest(manifest: MapManifest, mapId: MapId): void {
  if (manifest.format !== MANIFEST_FORMAT) {
    throw new RangeError(`manifest 格式不支持: ${manifest.format}`);
  }
  if (manifest.map.mapId !== mapId) {
    throw new RangeError(
      `manifest.map.mapId (${manifest.map.mapId}) 与请求地图 (${mapId}) 不一致`,
    );
  }
  if (!Array.isArray(manifest.floors) || manifest.floors.length === 0) {
    throw new RangeError('manifest.floors 不能为空');
  }
}

/** 同一地图的加载结果按 mapId 复用（并发与重复调用共享同一次网络请求）。 */
const bundleCache = new Map<MapId, Promise<MapBundle>>();

/** 清空加载缓存（测试隔离用）。 */
export function resetBundleCache(): void {
  bundleCache.clear();
}

/**
 * 拉取并校验一张地图的数据包。
 *
 * 失败归类：资源缺失/网络不可达 → MapDataUnavailableError；
 * 容器校验/manifest 不合法 → MapDataCorruptError；其余原样抛出。
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

  const bytes = await fetchBundle(mapId, definition.bundleUrl, onProgress);

  let loader: DmapLoader;
  try {
    loader = await DmapLoader.open(bytes, DMAP_KEY_MATERIAL);
  } catch (error) {
    if (error instanceof DmapError) {
      throw new MapDataCorruptError(mapId, error);
    }
    throw error;
  }

  try {
    const manifest = loader.readJson<MapManifest>(MANIFEST_ENTRY);
    validateManifest(manifest, mapId);
    onProgress?.(1);
    return { definition, manifest, loader };
  } catch (error) {
    throw new MapDataCorruptError(mapId, error);
  }
}

async function fetchBundle(
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

  const totalHeader = response.headers.get('content-length');
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
        // 无 Content-Length：以 64MB 经验规模给出平滑的参考进度。
        lastReported = Math.min(0.95, lastReported + value.byteLength / (64 * 1024 * 1024));
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

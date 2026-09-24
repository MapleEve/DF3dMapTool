import { DmapError, DmapLoader } from '@df3dmaptool/dmap';
import { DMAP_KEY_MATERIAL } from './dmapKey';
import { AssetFetchError } from './assets';

/**
 * 数据包清单（manifest.json）的运行时结构。
 * 与资产管线的打包格式一一对应：清单是全部内置地图的索引（maps 数组），
 * 其中本容器承载的地图条目携带 entries 与 chunkBounds；chunk 资产
 * 按 chunkBounds[i].container 分散到 containers 列表的容器中。
 */
export const MAP_MANIFEST_ENTRY = 'manifest.json';
export const MAP_MANIFEST_FORMAT = 'dmap-map-manifest/2';

export interface DmapChunkInfo {
  readonly id: string;
  /** 容器内条目路径（相对容器根，如 maps/az3/chunks/b12_-18.glb）。 */
  readonly file: string;
  readonly container: number;
  readonly instances: number;
  readonly vertices: number;
  readonly triangles: number;
  readonly geometries: number;
  readonly bytes: number;
  readonly bytesCompressed?: number;
  readonly boundsMin: readonly [number, number, number];
  readonly boundsMax: readonly [number, number, number];
}

export interface DmapMapManifestEntries {
  readonly scene: string;
  readonly poi: string;
  readonly map2d: string;
  readonly configs: readonly string[];
  readonly icons: string;
  readonly minimaps: string;
}

export interface DmapMapCounts {
  readonly chunks: number;
  readonly instances: number;
  readonly vertices: number;
  readonly triangles: number;
  readonly geometries: number;
  readonly pois: number;
}

/** 清单索引中一张地图的条目（本容器的承载图才带 entries/chunkBounds）。 */
export interface DmapMapIndexEntry {
  readonly mapId: number;
  readonly code: string;
  readonly floors: readonly number[];
  readonly containers: readonly string[];
  readonly counts: DmapMapCounts;
  readonly entries?: DmapMapManifestEntries;
  readonly chunkBounds?: readonly DmapChunkInfo[];
}

/** 容器内 manifest.json 的原始形态（全部地图的索引）。 */
export interface DmapMapManifestIndex {
  readonly format: string;
  readonly maps: readonly DmapMapIndexEntry[];
}

/** 解析后的单图清单视图（本容器承载的地图，结构与 /1 时代同构）。 */
export interface DmapMapManifest {
  readonly format: string;
  readonly map: { readonly mapId: number; readonly code: string };
  readonly floors: readonly number[];
  readonly containers: readonly string[];
  readonly entries: DmapMapManifestEntries;
  readonly counts: DmapMapCounts;
  readonly chunkBounds: readonly DmapChunkInfo[];
}

/** 场景元数据（entries.scene 指向的 JSON，坐标已统一到运行时世界系）。 */
export interface SceneFloorTrigger {
  readonly floor: number;
  readonly boundsCenter: readonly [number, number, number];
  readonly boundsExtent: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number, number];
}

export interface SceneDoc {
  readonly mapCode: string;
  readonly mapId: number;
  readonly floorValues: readonly number[];
  readonly bounds: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  };
  readonly floorTriggers: readonly SceneFloorTrigger[];
}

/** 数据包校验失败（清单缺失/格式不符/字段非法）。 */
export class MapBundleFormatError extends Error {
  readonly url: string;

  constructor(url: string, message: string) {
    super(`数据包清单不合法: ${message} (${url})`);
    this.name = 'MapBundleFormatError';
    this.url = url;
  }
}

/**
 * 已打开的地图数据包：首个容器持有清单，chunk 及附属资产按需
 * 从对应容器读取；容器文件首次访问时才拉取并解密，之后常驻内存。
 */
export class DmapMapBundle {
  /** 本容器承载地图的单图清单视图（从索引解析）。 */
  readonly manifest: DmapMapManifest;
  /** 容器内嵌的完整 6 图索引。 */
  readonly index: DmapMapManifestIndex;
  readonly #baseUrl: string;
  readonly #containers = new Map<number, DmapLoader>();

  private constructor(
    baseUrl: string,
    manifest: DmapMapManifest,
    index: DmapMapManifestIndex,
    primary: DmapLoader,
  ) {
    this.#baseUrl = baseUrl;
    this.manifest = manifest;
    this.index = index;
    this.#containers.set(0, primary);
  }

  /** 拉取首个容器并校验清单；网络失败抛 AssetFetchError，容器校验失败抛 DmapError。 */
  static async open(url: string, expectedMapId?: number): Promise<DmapMapBundle> {
    const primary = await openContainer(url);
    return DmapMapBundle.fromLoader(primary, url, expectedMapId);
  }

  /**
   * 基于已打开的容器构建（baseUrl 用于清单声明多容器时按需加载相邻分片）。
   * 数据层已下载/解密同一容器时复用，避免重复拉取。
   * expectedMapId 提供时按其解析；否则解析容器唯一承载的地图条目。
   */
  static fromLoader(loader: DmapLoader, baseUrl: string, expectedMapId?: number): DmapMapBundle {
    let index: DmapMapManifestIndex;
    let manifest: DmapMapManifest;
    try {
      index = loader.readJson<DmapMapManifestIndex>(MAP_MANIFEST_ENTRY);
      manifest = resolveOwnManifest(index, expectedMapId);
    } catch (error) {
      if (error instanceof DmapError) {
        throw error;
      }
      if (error instanceof MapBundleFormatError) {
        throw error;
      }
      throw new MapBundleFormatError(
        baseUrl,
        error instanceof Error ? error.message : '缺少或无法解析 manifest.json',
      );
    }
    validateManifest(manifest, baseUrl);
    return new DmapMapBundle(baseUrl, manifest, index, loader);
  }

  get mapId(): number {
    return this.manifest.map.mapId;
  }

  get mapCode(): string {
    return this.manifest.map.code;
  }

  get floors(): readonly number[] {
    return this.manifest.floors;
  }

  /** 容器 i 的加载器；首容器常驻，其余按需拉取。 */
  async container(index: number): Promise<DmapLoader> {
    const cached = this.#containers.get(index);
    if (cached !== undefined) {
      return cached;
    }
    const name = this.manifest.containers[index];
    if (name === undefined) {
      throw new RangeError(`容器序号越界: ${index}（共 ${this.manifest.containers.length} 个）`);
    }
    const url = joinUrl(this.#baseUrl, name);
    const loader = await openContainer(url);
    this.#containers.set(index, loader);
    return loader;
  }

  /** 读取 JSON 资产（如 scene.json / poi.json）。 */
  async readJson<T>(name: string, containerIndex = 0): Promise<T> {
    const container = await this.container(containerIndex);
    return container.readJson<T>(name);
  }

  /** 读取 chunk 的 GLB 字节（container 序号取自 manifest.chunkBounds）。 */
  async readChunkBytes(info: {
    readonly file: string;
    readonly container: number;
  }): Promise<Uint8Array> {
    const container = await this.container(info.container);
    return container.read(this.chunkEntryName(info.file));
  }

  /** manifest.chunkBounds[].file 是相对地图目录的路径，打包条目带 maps/<code>/ 前缀。 */
  chunkEntryName(file: string): string {
    return `maps/${this.manifest.map.code}/${file}`;
  }

  /** 预取全部容器（可选：首屏后预热，减少首块加载等待）。 */
  async preloadAllContainers(): Promise<void> {
    await Promise.all(this.manifest.containers.map((_, index) => this.container(index)));
  }

  dispose(): void {
    this.#containers.clear();
  }
}

/** 场景元数据便捷读取。 */
export async function readSceneDoc(bundle: DmapMapBundle): Promise<SceneDoc> {
  return bundle.readJson<SceneDoc>(bundle.manifest.entries.scene);
}

async function openContainer(url: string): Promise<DmapLoader> {
  const response = await fetch(url).catch((cause: unknown) => {
    const error = new AssetFetchError(url, 0);
    error.cause = cause;
    throw error;
  });
  if (!response.ok) {
    throw new AssetFetchError(url, response.status);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return DmapLoader.open(bytes, DMAP_KEY_MATERIAL);
}

/**
 * 从索引解析本容器承载的地图条目：
 * expectedMapId 提供时按其匹配，否则要求承载图条目（携带非空 chunkBounds）唯一。
 */
function resolveOwnManifest(index: DmapMapManifestIndex, expectedMapId?: number): DmapMapManifest {
  if (index.format !== MAP_MANIFEST_FORMAT) {
    throw new RangeError(`format 应为 ${MAP_MANIFEST_FORMAT}`);
  }
  if (!Array.isArray(index.maps) || index.maps.length === 0) {
    throw new RangeError('manifest.maps 不能为空');
  }
  let entry: DmapMapIndexEntry | undefined;
  if (expectedMapId !== undefined) {
    entry = index.maps.find((item) => item.mapId === expectedMapId);
  } else {
    const carriers = index.maps.filter(
      (item) => Array.isArray(item.chunkBounds) && item.chunkBounds.length > 0,
    );
    if (carriers.length === 1) {
      entry = carriers[0];
    }
  }
  if (entry === undefined) {
    throw new RangeError(
      expectedMapId !== undefined
        ? `manifest.maps 中不存在地图 ${expectedMapId}`
        : '承载图条目应唯一',
    );
  }
  if (
    entry.entries === undefined ||
    !Array.isArray(entry.chunkBounds) ||
    entry.chunkBounds.length === 0
  ) {
    throw new RangeError(`本容器不承载地图 ${entry.mapId} 的数据`);
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

function validateManifest(manifest: DmapMapManifest, url: string): void {
  const expect = (condition: boolean, message: string): void => {
    if (!condition) {
      throw new MapBundleFormatError(url, message);
    }
  };
  expect(manifest.format === MAP_MANIFEST_FORMAT, `format 应为 ${MAP_MANIFEST_FORMAT}`);
  expect(typeof manifest.map?.mapId === 'number', 'map.mapId 缺失');
  expect(typeof manifest.map?.code === 'string' && manifest.map.code.length > 0, 'map.code 缺失');
  expect(Array.isArray(manifest.floors) && manifest.floors.length > 0, 'floors 不能为空');
  expect(
    Array.isArray(manifest.containers) && manifest.containers.length > 0,
    'containers 不能为空',
  );
  expect(typeof manifest.entries?.scene === 'string', 'entries.scene 缺失');
  expect(
    Array.isArray(manifest.chunkBounds) && manifest.chunkBounds.length > 0,
    'chunkBounds 不能为空',
  );
  for (const chunk of manifest.chunkBounds) {
    expect(typeof chunk.id === 'string' && chunk.id.length > 0, 'chunkBounds[].id 缺失');
    expect(typeof chunk.file === 'string', 'chunkBounds[].file 缺失');
    expect(
      Number.isInteger(chunk.container) &&
        chunk.container >= 0 &&
        chunk.container < manifest.containers.length,
      `chunk ${chunk.id} 的容器序号越界`,
    );
  }
}

function joinUrl(base: string, name: string): string {
  const dir = base.slice(0, base.lastIndexOf('/') + 1);
  return `${dir}${name}`;
}

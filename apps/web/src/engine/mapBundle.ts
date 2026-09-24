import { DmapError, DmapLoader } from '@df3dmaptool/dmap';
import { DMAP_KEY_MATERIAL } from './dmapKey';
import { AssetFetchError } from './assets';

/**
 * 数据包清单（manifest.json）的运行时结构。
 * 与资产管线的打包格式一一对应：清单在首个容器内，chunk 资产
 * 按 manifest.chunkBounds[i].container 分散到 containers 列表的容器中。
 */
export const MAP_MANIFEST_ENTRY = 'manifest.json';
export const MAP_MANIFEST_FORMAT = 'dmap-map-manifest/1';

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

export interface DmapMapManifest {
  readonly format: string;
  readonly map: { readonly mapId: number; readonly code: string };
  readonly floors: readonly number[];
  readonly containers: readonly string[];
  readonly entries: DmapMapManifestEntries;
  readonly counts: {
    readonly chunks: number;
    readonly instances: number;
    readonly vertices: number;
    readonly triangles: number;
    readonly geometries: number;
  };
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
  readonly manifest: DmapMapManifest;
  readonly #baseUrl: string;
  readonly #containers = new Map<number, DmapLoader>();

  private constructor(baseUrl: string, manifest: DmapMapManifest, primary: DmapLoader) {
    this.#baseUrl = baseUrl;
    this.manifest = manifest;
    this.#containers.set(0, primary);
  }

  /** 拉取首个容器并校验清单；网络失败抛 AssetFetchError，容器校验失败抛 DmapError。 */
  static async open(url: string): Promise<DmapMapBundle> {
    const primary = await openContainer(url);
    return DmapMapBundle.fromLoader(primary, url);
  }

  /**
   * 基于已打开的容器构建（baseUrl 用于清单声明多容器时按需加载相邻分片）。
   * 数据层已下载/解密同一容器时复用，避免重复拉取。
   */
  static fromLoader(loader: DmapLoader, baseUrl: string): DmapMapBundle {
    let manifest: DmapMapManifest;
    try {
      manifest = loader.readJson<DmapMapManifest>(MAP_MANIFEST_ENTRY);
    } catch (error) {
      if (error instanceof DmapError) {
        throw error;
      }
      throw new MapBundleFormatError(baseUrl, '缺少或无法解析 manifest.json');
    }
    validateManifest(manifest, baseUrl);
    return new DmapMapBundle(baseUrl, manifest, loader);
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
    await Promise.all(
      this.manifest.containers.map((_, index) => this.container(index)),
    );
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
  expect(Array.isArray(manifest.containers) && manifest.containers.length > 0, 'containers 不能为空');
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

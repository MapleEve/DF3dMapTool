import { DmapLoader } from "./loader.js";
import {
  CHUNK_ENTRY_NAME,
  MAP_MANIFEST_ENTRY,
  parseMapManifest,
  type DmapChunkRef,
  type DmapMapManifest,
} from "./manifest.js";
import { DmapError, DmapFormatError } from "./errors.js";
import { resolveAesKey, type DmapKeySource } from "./key.js";

/**
 * 分片地图包加载器（“索引容器 + 载荷容器”两段式）。
 *
 * ```ts
 * const pkg = await DmapMapPackage.openIndex(indexBytes, keyMaterial, {
 *   fetchContainer: (file) => fetch(urlOf(file)).then((r) => r.bytes()),
 * });
 * const poi = pkg.readJson(pkg.manifest.entries.poi);     // 索引容器：立即可读
 * const glb = await pkg.readChunk(pkg.manifest.chunks[0]); // 分块容器：按名惰性拉取
 * ```
 *
 * - **第一段**：`openIndex` 打开索引容器，解析并校验 dmap-map-manifest/3 清单
 *   ——POI/配置/图标/2D 标定随索引即可读取，UI 无需等待任何分块；
 * - **第二段**：`readChunk` 按清单中的容器文件名惰性拉取分块容器
 *   （宿主经 `fetchContainer` 注入字节来源），成功打开的容器常驻缓存，
 *   打开失败不缓存——重试会重新拉取字节。
 */
export interface DmapMapPackageOptions {
  /** 分块容器字节来源：入参为清单 chunks[].file（相对地图资产目录）。 */
  readonly fetchContainer?: (file: string) => Promise<Uint8Array>;
}

export class DmapMapPackage {
  /** 解析并校验后的单图清单。 */
  readonly manifest: DmapMapManifest;
  readonly #index: DmapLoader;
  readonly #keySource: DmapKeySource;
  readonly #fetchContainer: ((file: string) => Promise<Uint8Array>) | null;
  readonly #chunkLoaders = new Map<string, Promise<DmapLoader>>();

  private constructor(
    manifest: DmapMapManifest,
    index: DmapLoader,
    keySource: DmapKeySource,
    fetchContainer: ((file: string) => Promise<Uint8Array>) | null,
  ) {
    this.manifest = manifest;
    this.#index = index;
    this.#keySource = keySource;
    this.#fetchContainer = fetchContainer;
  }

  /**
   * 两段式打开的第一段：校验索引容器字节并解析 v3 清单。
   * 容器完整性失败抛 DmapIntegrityError，清单不合法抛 `bad_manifest`。
   */
  static async openIndex(
    indexBytes: Uint8Array,
    keySource: DmapKeySource,
    options: DmapMapPackageOptions = {},
  ): Promise<DmapMapPackage> {
    const index = await DmapLoader.open(indexBytes, keySource);
    let manifest: DmapMapManifest;
    try {
      manifest = parseMapManifest(index.readJson<unknown>(MAP_MANIFEST_ENTRY));
    } catch (error) {
      if (error instanceof DmapError) {
        throw error;
      }
      throw new DmapFormatError("bad_manifest", "manifest.json 不是合法 JSON");
    }
    return new DmapMapPackage(manifest, index, keySource, options.fetchContainer ?? null);
  }

  /** 索引容器加载器（清单内条目直读；一般经由本类的委托方法访问）。 */
  get indexLoader(): DmapLoader {
    return this.#index;
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

  // ---- 索引容器条目读取（POI/配置/图标/2D 标定，UI 先到先渲染）----

  has(name: string): boolean {
    return this.#index.has(name);
  }

  listEntries(): ReturnType<DmapLoader["list"]> {
    return this.#index.list();
  }

  read(name: string): Uint8Array {
    return this.#index.read(name);
  }

  readText(name: string): string {
    return this.#index.readText(name);
  }

  readJson<T = unknown>(name: string): T {
    return this.#index.readJson<T>(name);
  }

  // ---- 分块容器（第二段：按名惰性打开 + 缓存）----

  /**
   * 读取一个分块的 GLB 载荷字节。
   * 分块容器按清单文件名惰性拉取并缓存；未注入 fetchContainer 时抛 DmapFormatError。
   */
  async readChunk(chunk: Pick<DmapChunkRef, "file">): Promise<Uint8Array> {
    const loader = await this.chunkLoader(chunk.file);
    return loader.read(CHUNK_ENTRY_NAME);
  }

  /** 分块容器加载器：首次访问拉取并打开，成功后常驻缓存；失败不缓存（可重试）。 */
  async chunkLoader(file: string): Promise<DmapLoader> {
    const cached = this.#chunkLoaders.get(file);
    if (cached !== undefined) {
      return cached;
    }
    const fetcher = this.#fetchContainer;
    if (fetcher === null) {
      throw new DmapFormatError("bad_manifest", `未配置分块容器来源，无法读取 ${file}`);
    }
    const key = await resolveAesKey(this.#keySource);
    const pending = (async () => {
      const bytes = await fetcher(file);
      return DmapLoader.open(bytes, key);
    })();
    this.#chunkLoaders.set(file, pending);
    // 打开失败不缓存：下一次读取会重新经 fetchContainer 拉取。
    pending.catch(() => this.#chunkLoaders.delete(file));
    return pending;
  }

  /** 已缓存的分块容器数（预取/调试用）。 */
  get cachedChunkCount(): number {
    return this.#chunkLoaders.size;
  }

  /** 预取一个分块容器（只下载+校验，不读载荷）；返回是否成功。 */
  async prefetchChunk(chunk: Pick<DmapChunkRef, "file">): Promise<boolean> {
    try {
      await this.chunkLoader(chunk.file);
      return true;
    } catch {
      return false;
    }
  }

  /** 释放全部缓存（索引容器数据保持可用，仅丢弃分块容器缓存）。 */
  dispose(): void {
    this.#chunkLoaders.clear();
  }
}

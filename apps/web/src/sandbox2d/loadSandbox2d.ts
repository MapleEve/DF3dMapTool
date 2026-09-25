/**
 * sandbox2d.dmap 容器拉取/校验/读取（仿 data/loadMap 模式，独立 bundleCache）。
 *
 * 惰性加载：首次进入 2D 视图才拉取；同图并发共享一次请求。容器格式
 * dmap-sandbox2d-manifest/1（与 dmap-map-manifest/3 完全独立，R10）。
 * 失败归类：网络/404 → unavailable；DMAP 校验/清单不合法 → corrupt。
 */

import { DmapError, DmapLoader } from "@df3dmaptool/dmap";
import { DMAP_KEY_MATERIAL } from "@/engine/dmapKey";
import type { MapDefinition, MapId } from "@/map/types";
import type {
  Sandbox2dData,
  Sandbox2dManifest,
  SandboxIconIndex,
  SandboxMediaIndex,
} from "./types";

export type SandboxLoadErrorCode = "unavailable" | "corrupt" | "unknown";

export class Sandbox2dUnavailableError extends Error {
  constructor(mapId: MapId) {
    super(`2D 沙盘数据包不可用: ${mapId}`);
    this.name = "Sandbox2dUnavailableError";
  }
}

export class Sandbox2dCorruptError extends Error {
  constructor(mapId: MapId, cause?: unknown) {
    super(`2D 沙盘数据包校验失败: ${mapId}`);
    this.name = "Sandbox2dCorruptError";
    this.cause = cause;
  }
}

export function sandboxLoadErrorCode(error: unknown): SandboxLoadErrorCode {
  if (error instanceof Sandbox2dUnavailableError) {
    return "unavailable";
  }
  if (error instanceof Sandbox2dCorruptError) {
    return "corrupt";
  }
  return "unknown";
}

/** 打开的 2D 沙盘数据包：清单 + 数据 + 位图对象 URL 缓存（按包持有）。 */
export interface Sandbox2dPackage {
  readonly definition: MapDefinition;
  readonly manifest: Sandbox2dManifest;
  readonly data: Sandbox2dData;
  readonly iconIndex: SandboxIconIndex;
  readonly mediaIndex: SandboxMediaIndex;
  readonly loader: DmapLoader;
  /**
   * 读取容器内条目为 object URL（按包缓存；切图即随包释放）。
   * 同一条目多次调用返回**同一 URL**（共享）：画布解码/侧栏图标/详情面板共用，
   * 调用方不得 revoke——URL 生命周期归数据包所有。
   */
  getObjectUrl: (entry: string) => string | undefined;
}

const packageCache = new Map<MapId, Promise<Sandbox2dPackage>>();

/** 清空加载缓存（测试隔离用）。 */
export function resetSandbox2dCache(): void {
  packageCache.clear();
}

/** 拉取并打开一张地图的 2D 沙盘容器；同图并发共享同一次请求。 */
export function loadSandbox2d(definition: MapDefinition): Promise<Sandbox2dPackage> {
  const cached = packageCache.get(definition.id);
  if (cached !== undefined) {
    return cached;
  }
  const pending = doLoadSandbox2d(definition);
  packageCache.set(definition.id, pending);
  pending.catch(() => {
    packageCache.delete(definition.id);
  });
  return pending;
}

async function doLoadSandbox2d(definition: MapDefinition): Promise<Sandbox2dPackage> {
  const url = definition.sandbox2dUrl;
  if (url === undefined) {
    throw new Sandbox2dUnavailableError(definition.id);
  }
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Sandbox2dUnavailableError(definition.id);
  }
  if (!response.ok) {
    throw new Sandbox2dUnavailableError(definition.id);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());

  let loader: DmapLoader;
  try {
    loader = await DmapLoader.open(bytes, DMAP_KEY_MATERIAL);
  } catch (error) {
    if (error instanceof DmapError) {
      throw new Sandbox2dCorruptError(definition.id, error);
    }
    throw error;
  }

  let manifest: Sandbox2dManifest;
  let data: Sandbox2dData;
  let iconIndex: SandboxIconIndex;
  let mediaIndex: SandboxMediaIndex;
  try {
    manifest = loader.readJson<Sandbox2dManifest>("sandbox2d/manifest.json");
    if (manifest.format !== "dmap-sandbox2d-manifest/1") {
      throw new RangeError(`未知沙盘清单格式: ${manifest.format}`);
    }
    if (manifest.mapId !== definition.id) {
      throw new RangeError(
        `沙盘数据包地图 (${manifest.mapId}) 与请求地图 (${definition.id}) 不一致`,
      );
    }
    data = loader.readJson<Sandbox2dData>(manifest.entries.data);
    iconIndex = loader.readJson<SandboxIconIndex>(manifest.entries.icons);
    mediaIndex = loader.readJson<SandboxMediaIndex>(manifest.entries.media);
  } catch (error) {
    if (error instanceof DmapError) {
      throw new Sandbox2dCorruptError(definition.id, error);
    }
    throw new Sandbox2dCorruptError(definition.id, error);
  }

  const urlCache = new Map<string, string>();
  const getObjectUrl = (entry: string): string | undefined => {
    const hit = urlCache.get(entry);
    if (hit !== undefined) {
      return hit;
    }
    if (!loader.has(entry)) {
      return undefined;
    }
    try {
      const content = loader.read(entry);
      const mime = entry.endsWith(".png") ? "image/png" : "image/webp";
      const objectUrl = URL.createObjectURL(
        new Blob([content.buffer as ArrayBuffer], { type: mime }),
      );
      urlCache.set(entry, objectUrl);
      return objectUrl;
    } catch {
      return undefined;
    }
  };

  return {
    definition,
    manifest,
    data,
    iconIndex,
    mediaIndex,
    loader,
    getObjectUrl,
  };
}

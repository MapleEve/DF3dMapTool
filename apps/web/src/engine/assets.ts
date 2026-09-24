import { DmapError, DmapLoader, DmapMapPackage } from "@df3dmaptool/dmap";
import { DMAP_KEY_MATERIAL } from "./dmapKey";

/** 数据包资源不存在（未随应用分发或路径错误）。 */
export class AssetFetchError extends Error {
  readonly url: string;
  readonly status: number;

  constructor(url: string, status: number) {
    super(`数据包获取失败: ${url} (HTTP ${status})`);
    this.name = "AssetFetchError";
    this.url = url;
    this.status = status;
  }
}

/** 拉取一个容器的原始字节；网络失败/非 2xx 抛 AssetFetchError。 */
export async function fetchContainerBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url).catch((cause: unknown) => {
    const error = new AssetFetchError(url, 0);
    error.cause = cause;
    throw error;
  });
  if (!response.ok) {
    throw new AssetFetchError(url, response.status);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * 拉取并打开一个单容器 .dmap（导航容器等）。
 * 容器头/完整性校验失败会抛出 @df3dmaptool/dmap 的 DmapError 子类，
 * 网络层失败抛出 AssetFetchError。
 */
export async function openMapBundle(url: string): Promise<DmapLoader> {
  return DmapLoader.open(await fetchContainerBytes(url), DMAP_KEY_MATERIAL);
}

/** 相对索引容器地址解析分块/导航容器地址。 */
export function joinAssetUrl(baseUrl: string, file: string): string {
  const dir = baseUrl.slice(0, baseUrl.lastIndexOf("/") + 1);
  return `${dir}${file}`;
}

/**
 * 分块容器字节来源：按清单 chunks[].file（相对地图资产目录）
 * 从索引容器同目录拉取。数据层与引擎层共用。
 */
export function containerFetcher(baseUrl: string): (file: string) => Promise<Uint8Array> {
  return (file: string) => fetchContainerBytes(joinAssetUrl(baseUrl, file));
}

/**
 * 拉取并打开一张地图的分片数据包（两段式的第一段在此完成网络侧）：
 * 下载索引容器字节 → DmapMapPackage.openIndex，分块容器按名惰性拉取。
 */
export async function openMapPackage(indexUrl: string): Promise<DmapMapPackage> {
  const bytes = await fetchContainerBytes(indexUrl);
  return DmapMapPackage.openIndex(bytes, DMAP_KEY_MATERIAL, {
    fetchContainer: containerFetcher(indexUrl),
  });
}

/** 判断错误是否为 DMAP 体系内错误（格式/完整性/密钥）。 */
export function isDmapError(error: unknown): error is DmapError {
  return error instanceof DmapError;
}

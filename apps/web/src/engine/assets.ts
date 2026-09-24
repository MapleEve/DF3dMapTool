import { DmapError, DmapLoader } from '@df3dmaptool/dmap';
import { DMAP_KEY_MATERIAL } from './dmapKey';

/** 数据包资源不存在（未随应用分发或路径错误）。 */
export class AssetFetchError extends Error {
  readonly url: string;
  readonly status: number;

  constructor(url: string, status: number) {
    super(`数据包获取失败: ${url} (HTTP ${status})`);
    this.name = 'AssetFetchError';
    this.url = url;
    this.status = status;
  }
}

/**
 * 拉取并打开一个 .dmap 数据包。
 * 容器头/完整性校验失败会抛出 @df3dmaptool/dmap 的 DmapError 子类，
 * 网络层失败抛出 AssetFetchError。
 */
export async function openMapBundle(url: string): Promise<DmapLoader> {
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

/** 判断错误是否为 DMAP 体系内错误（格式/完整性/密钥）。 */
export function isDmapError(error: unknown): error is DmapError {
  return error instanceof DmapError;
}

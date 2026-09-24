import { toCryptoBytes } from './bytes.js';
import { DmapFormatError, DmapIntegrityError } from './errors.js';

/** 容器 magic，ASCII "DMAP"。 */
export const MAGIC_BYTES: readonly number[] = [0x44, 0x4d, 0x41, 0x50];
/** 当前容器格式版本。 */
export const FORMAT_VERSION = 1;
/** 头部长度：magic(4) + version(4) + flags(4) + iv(12)。 */
export const HEADER_BYTES = 24;
/** GCM 随机向量长度。 */
export const IV_BYTES = 12;
/** GCM 认证标签长度。 */
export const TAG_BYTES = 16;

export interface DmapHeader {
  readonly version: number;
  readonly flags: number;
  readonly iv: Uint8Array;
}

function isMagic(bytes: Uint8Array): boolean {
  for (let i = 0; i < MAGIC_BYTES.length; i += 1) {
    if (bytes[i] !== MAGIC_BYTES[i]) {
      return false;
    }
  }
  return true;
}

/** 序列化 24 字节容器头。 */
export function encodeHeader(header: DmapHeader): Uint8Array {
  if (header.iv.length !== IV_BYTES) {
    throw new DmapFormatError('bad_header', `IV 必须为 ${IV_BYTES} 字节`);
  }
  const bytes = new Uint8Array(HEADER_BYTES);
  bytes.set(MAGIC_BYTES, 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, header.version, true);
  view.setUint32(8, header.flags, true);
  bytes.set(header.iv, 12);
  return bytes;
}

/** 解析并校验容器头；magic/版本/长度不合法时抛出 DmapFormatError。 */
export function decodeHeader(bytes: Uint8Array): DmapHeader {
  if (bytes.length < HEADER_BYTES) {
    throw new DmapFormatError(
      'truncated',
      `容器头部不完整：期望至少 ${HEADER_BYTES} 字节，实际 ${bytes.length} 字节`,
    );
  }
  if (!isMagic(bytes)) {
    throw new DmapFormatError('bad_header', '容器 magic 不正确，不是 DMAP 文件');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, true);
  if (version !== FORMAT_VERSION) {
    throw new DmapFormatError(
      'unsupported_version',
      `不支持的容器版本: ${version}（当前支持 ${FORMAT_VERSION}）`,
    );
  }
  const flags = view.getUint32(8, true);
  const iv = bytes.slice(12, 12 + IV_BYTES);
  return { version, flags, iv };
}

/**
 * 加密封 payload：AES-256-GCM，认证标签 128bit，
 * 以完整 24 字节容器头作为 additionalData 绑定，头字节被篡改同样会导致校验失败。
 */
export async function sealPayload(
  payload: Uint8Array,
  key: CryptoKey,
  iv: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toCryptoBytes(iv), additionalData: toCryptoBytes(aad), tagLength: 128 },
    key,
    toCryptoBytes(payload),
  );
  return new Uint8Array(sealed);
}

/** 还原 payload：GCM 认证标签不匹配（篡改/密钥错误）时抛出 DmapIntegrityError。 */
export async function unsealPayload(
  sealed: Uint8Array,
  key: CryptoKey,
  iv: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toCryptoBytes(iv),
        additionalData: toCryptoBytes(aad),
        tagLength: 128,
      },
      key,
      toCryptoBytes(sealed),
    );
  } catch {
    throw new DmapIntegrityError('载荷完整性校验失败：数据被篡改或密钥不匹配');
  }
  return new Uint8Array(plain);
}

/** 生成随机 IV。 */
export function randomIv(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(IV_BYTES));
}

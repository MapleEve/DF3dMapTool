/**
 * 内置资产密钥，请勿外传。
 *
 * 密钥材料拆为 4 段，与各自常量表逐字节异或后拼接成 32 字节中间材料，
 * 再经 SHA-256 派生 AES-256 密钥（派生逻辑见 @df3dmaptool/dmap）。
 *
 * 本文件由资产管线维护：更换密钥必须同步重建全部 .dmap 数据包，
 * 手工修改会导致数据包无法通过完整性校验。
 */
import { deriveKey, type DmapKeyMaterial } from "@df3dmaptool/dmap";

const SEGMENT_HEX = [
  "9ca93ee8fbed4c4c",
  "0fb380eaae8792d9",
  "b6f62a47cf873b15",
  "295665181f2c3354",
] as const;

const TABLE_HEX = [
  "a721ca57fb8d5e18",
  "0933027b82154d12",
  "e27bdfc2909b2a60",
  "207061e7ea8e2b07",
] as const;

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export const DMAP_KEY_SEGMENTS: readonly Uint8Array[] = SEGMENT_HEX.map(fromHex);
export const DMAP_KEY_TABLES: readonly Uint8Array[] = TABLE_HEX.map(fromHex);

export const DMAP_KEY_MATERIAL: DmapKeyMaterial = {
  segments: DMAP_KEY_SEGMENTS,
  tables: DMAP_KEY_TABLES,
};

/** 派生本应用数据包的 AES-256 密钥。 */
export function deriveDmapKey(): Promise<CryptoKey> {
  return deriveKey(DMAP_KEY_MATERIAL);
}

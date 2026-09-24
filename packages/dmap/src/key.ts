import { toCryptoBytes } from "./bytes.js";
import { DmapKeyError } from "./errors.js";

/** 密钥材料段数。 */
export const SEGMENT_COUNT = 4;
/** 每段字节数，4 段共 32 字节中间材料。 */
export const SEGMENT_BYTES = 8;
/** 派生出的 AES-256 密钥长度。 */
export const KEY_BYTES = 32;

/**
 * 内置密钥材料的抽象：4 段密钥段 + 4 张异或常量表。
 * 段与表由宿主应用提供（见 apps/web/src/engine/dmapKey.ts），本包不内置任何密钥。
 */
export interface DmapKeyMaterial {
  readonly segments: readonly Uint8Array[];
  readonly tables: readonly Uint8Array[];
}

/** 写入器/加载器接受的密钥来源：原始材料（自动派生）或已派生的 AES-GCM CryptoKey。 */
export type DmapKeySource = DmapKeyMaterial | CryptoKey;

export function isDmapKeyMaterial(value: unknown): value is DmapKeyMaterial {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<DmapKeyMaterial>;
  return (
    Array.isArray(candidate.segments) &&
    Array.isArray(candidate.tables) &&
    candidate.segments.length === SEGMENT_COUNT &&
    candidate.tables.length === SEGMENT_COUNT &&
    candidate.segments.every(
      (segment) => segment instanceof Uint8Array && segment.length === SEGMENT_BYTES,
    ) &&
    candidate.tables.every((table) => table instanceof Uint8Array && table.length === SEGMENT_BYTES)
  );
}

function assertMaterial(material: DmapKeyMaterial): void {
  if (!isDmapKeyMaterial(material)) {
    throw new DmapKeyError(
      `密钥材料不合法：需要 ${SEGMENT_COUNT} 段、每段 ${SEGMENT_BYTES} 字节的 segments 与 tables`,
    );
  }
}

/**
 * 密钥派生第一步：逐段与常量表异或，拼接为 32 字节中间材料。
 * 纯同步、无随机性，相同材料永远得到相同输出。
 */
export function deriveRawKeyBytes(material: DmapKeyMaterial): Uint8Array {
  assertMaterial(material);
  const mixed = new Uint8Array(SEGMENT_COUNT * SEGMENT_BYTES);
  for (let i = 0; i < SEGMENT_COUNT; i += 1) {
    const segment = material.segments[i];
    const table = material.tables[i];
    for (let j = 0; j < SEGMENT_BYTES; j += 1) {
      mixed[i * SEGMENT_BYTES + j] = segment[j] ^ table[j];
    }
  }
  return mixed;
}

/**
 * 密钥派生第二步：对中间材料做 SHA-256，得到 32 字节 AES-256 密钥并导入 WebCrypto。
 * 返回的 CryptoKey 不可导出（extractable=false），只能用于 AES-GCM 加解封。
 */
export async function deriveKey(material: DmapKeyMaterial): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", toCryptoBytes(deriveRawKeyBytes(material)));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** 归一化密钥来源：材料则现场派生，CryptoKey 则直接使用。 */
export async function resolveAesKey(source: DmapKeySource): Promise<CryptoKey> {
  if (isDmapKeyMaterial(source)) {
    return deriveKey(source);
  }
  return source;
}

import { readEntryData, unpackBundle, type DmapcIndexEntry } from './bundle.js';
import { decodeHeader, HEADER_BYTES, TAG_BYTES, unsealPayload } from './container.js';
import { DmapFormatError } from './errors.js';
import { resolveAesKey, type DmapKeySource } from './key.js';

export interface DmapEntryInfo {
  readonly name: string;
  readonly mime: string;
  readonly byteLength: number;
}

const decoder = new TextDecoder();

/**
 * DMAP 加载器（浏览器 / Node 通用）。
 *
 * ```ts
 * const loader = await DmapLoader.open(bytes, keyMaterial);
 * const manifest = loader.readJson<MapManifest>('manifest.json');
 * const png = loader.read('tiles/az3_1f.png');
 * ```
 *
 * `open` 完成容器头校验、密钥派生与载荷完整性校验；
 * 通过后 `read`/`readText`/`readJson` 按 dmapc 索引取条目。
 */
export class DmapLoader {
  readonly formatVersion: number;
  readonly flags: number;
  readonly #entries: readonly DmapcIndexEntry[];
  readonly #bin: Uint8Array;

  private constructor(
    formatVersion: number,
    flags: number,
    entries: readonly DmapcIndexEntry[],
    bin: Uint8Array,
  ) {
    this.formatVersion = formatVersion;
    this.flags = flags;
    this.#entries = entries;
    this.#bin = bin;
  }

  /** 解析容器字节并完成完整性校验；任何一步失败都会抛出对应的 DmapError 子类。 */
  static async open(bytes: Uint8Array, keySource: DmapKeySource): Promise<DmapLoader> {
    if (bytes.length < HEADER_BYTES + TAG_BYTES) {
      throw new DmapFormatError(
        'truncated',
        `容器过短：至少 ${HEADER_BYTES + TAG_BYTES} 字节，实际 ${bytes.length} 字节`,
      );
    }
    const header = decodeHeader(bytes);
    const key = await resolveAesKey(keySource);
    const sealed = bytes.subarray(HEADER_BYTES);
    const payload = await unsealPayload(sealed, key, header.iv, bytes.subarray(0, HEADER_BYTES));
    const bundle = unpackBundle(payload);
    return new DmapLoader(header.version, header.flags, bundle.entries, bundle.bin);
  }

  get entryCount(): number {
    return this.#entries.length;
  }

  /** 列出全部条目元信息。 */
  list(): DmapEntryInfo[] {
    return this.#entries.map((entry) => ({
      name: entry.name,
      mime: entry.mime,
      byteLength: entry.byteLength,
    }));
  }

  has(name: string): boolean {
    return this.#entries.some((entry) => entry.name === name);
  }

  /** 读取条目原始字节（返回副本，调用方可安全持有/修改）。 */
  read(name: string): Uint8Array {
    const data = readEntryData({ entries: this.#entries, bin: this.#bin }, name);
    return data.slice();
  }

  /** 读取条目并按 UTF-8 解码为文本。 */
  readText(name: string): string {
    return decoder.decode(readEntryData({ entries: this.#entries, bin: this.#bin }, name));
  }

  /** 读取条目并解析为 JSON。 */
  readJson<T = unknown>(name: string): T {
    return JSON.parse(this.readText(name)) as T;
  }
}

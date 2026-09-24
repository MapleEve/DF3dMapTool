import { packBundle, type BundleEntry } from './bundle.js';
import {
  encodeHeader,
  FORMAT_VERSION,
  randomIv,
  sealPayload,
  HEADER_BYTES,
  IV_BYTES,
} from './container.js';
import { resolveAesKey, type DmapKeySource } from './key.js';

export interface DmapWriteOptions {
  /** 容器 flags 位段，保留给未来特性；默认 0。 */
  readonly flags?: number;
  /** 显式指定 IV（测试/复现用）；默认随机生成。 */
  readonly iv?: Uint8Array;
}

const encoder = new TextEncoder();

/**
 * DMAP 写入器（Node 侧资产管线使用）。
 *
 * 用法：
 * ```ts
 * const bytes = await DmapWriter.create()
 *   .addJson('manifest.json', manifest)
 *   .add('tiles/az3_1f.png', 'image/png', pngBytes)
 *   .write(keyMaterial);
 * ```
 */
export class DmapWriter {
  readonly #entries: BundleEntry[] = [];

  static create(): DmapWriter {
    return new DmapWriter();
  }

  /** 添加一条二进制数据；条目名必须唯一且非空。 */
  add(name: string, mime: string, data: Uint8Array): this {
    if (name.length === 0) {
      throw new RangeError('条目名不能为空');
    }
    if (this.#entries.some((entry) => entry.name === name)) {
      throw new RangeError(`条目名重复: ${name}`);
    }
    this.#entries.push({ name, mime, data });
    return this;
  }

  /** 添加 UTF-8 文本条目。 */
  addText(name: string, text: string, mime = 'text/plain; charset=utf-8'): this {
    return this.add(name, mime, encoder.encode(text));
  }

  /** 添加 JSON 条目。 */
  addJson(name: string, value: unknown, mime = 'application/json'): this {
    return this.addText(name, JSON.stringify(value), mime);
  }

  get entryCount(): number {
    return this.#entries.length;
  }

  /** 打包并加密封为完整 .dmap 容器。 */
  async write(keySource: DmapKeySource, options: DmapWriteOptions = {}): Promise<Uint8Array> {
    const key = await resolveAesKey(keySource);
    const iv = options.iv ?? randomIv();
    if (iv.length !== IV_BYTES) {
      throw new RangeError(`IV 必须为 ${IV_BYTES} 字节`);
    }
    const header = encodeHeader({ version: FORMAT_VERSION, flags: options.flags ?? 0, iv });
    const payload = packBundle(this.#entries);
    const sealed = await sealPayload(payload, key, iv, header);
    const out = new Uint8Array(HEADER_BYTES + sealed.length);
    out.set(header, 0);
    out.set(sealed, HEADER_BYTES);
    return out;
  }
}

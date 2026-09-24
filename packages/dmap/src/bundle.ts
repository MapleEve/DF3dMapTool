import { DmapEntryError, DmapFormatError } from './errors.js';

/** GLB 容器 magic，ASCII "glTF"。 */
const GLB_MAGIC = 0x46546c67;
/** GLB 规范版本。 */
const GLB_VERSION = 2;
const GLB_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
/** JSON chunk 类型，ASCII "JSON"。 */
const CHUNK_TYPE_JSON = 0x4e4f534a;
/** BIN chunk 类型，ASCII "BIN\\0"。 */
const CHUNK_TYPE_BIN = 0x004e4942;

/** dmapc 索引的生成器标识。 */
export const DMAPC_GENERATOR = 'dmap-writer/1';

/** 待打包的一条数据。 */
export interface BundleEntry {
  readonly name: string;
  readonly mime: string;
  readonly data: Uint8Array;
}

/** dmapc 索引中的一条记录；byteOffset 相对 BIN chunk 数据起点。 */
export interface DmapcIndexEntry {
  readonly name: string;
  readonly mime: string;
  readonly byteOffset: number;
  readonly byteLength: number;
}

/** 打包进 JSON chunk 的 dmapc 索引。 */
export interface DmapcIndex {
  readonly asset: {
    readonly version: string;
    readonly generator: string;
  };
  readonly dmapc: {
    readonly entries: readonly DmapcIndexEntry[];
  };
}

export interface UnpackedBundle {
  readonly entries: readonly DmapcIndexEntry[];
  readonly bin: Uint8Array;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function align4(value: number): number {
  return (value + 3) & ~3;
}

/**
 * 将条目打包为 GLB 容器：JSON chunk 携带 dmapc 索引，BIN chunk 顺序存放条目数据。
 * JSON 以空格补齐到 4 字节对齐，BIN 以 0x00 补齐，符合 GLB 规范。
 */
export function packBundle(entries: readonly BundleEntry[]): Uint8Array {
  const names = new Set<string>();
  for (const entry of entries) {
    if (entry.name.length === 0) {
      throw new DmapFormatError('bad_bundle', '条目名不能为空');
    }
    if (names.has(entry.name)) {
      throw new DmapFormatError('bad_bundle', `条目名重复: ${entry.name}`);
    }
    names.add(entry.name);
  }

  const binLength = entries.reduce((sum, entry) => sum + entry.data.length, 0);
  const binPaddedLength = align4(binLength);
  const bin = new Uint8Array(binPaddedLength);

  const indexEntries: DmapcIndexEntry[] = [];
  let offset = 0;
  for (const entry of entries) {
    indexEntries.push({
      name: entry.name,
      mime: entry.mime,
      byteOffset: offset,
      byteLength: entry.data.length,
    });
    bin.set(entry.data, offset);
    offset += entry.data.length;
  }

  const index: DmapcIndex = {
    asset: { version: '2.0', generator: DMAPC_GENERATOR },
    dmapc: { entries: indexEntries },
  };
  const jsonBytes = encoder.encode(JSON.stringify(index));
  const jsonPaddedLength = align4(jsonBytes.length);
  const jsonChunk = new Uint8Array(jsonPaddedLength);
  jsonChunk.set(jsonBytes, 0);
  jsonChunk.fill(0x20, jsonBytes.length);

  const totalLength =
    GLB_HEADER_BYTES + CHUNK_HEADER_BYTES + jsonPaddedLength + CHUNK_HEADER_BYTES + binPaddedLength;

  const out = new Uint8Array(totalLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, GLB_VERSION, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonPaddedLength, true);
  view.setUint32(16, CHUNK_TYPE_JSON, true);
  out.set(jsonChunk, 20);
  const binChunkHeader = 20 + jsonPaddedLength;
  view.setUint32(binChunkHeader, binPaddedLength, true);
  view.setUint32(binChunkHeader + 4, CHUNK_TYPE_BIN, true);
  out.set(bin, binChunkHeader + CHUNK_HEADER_BYTES);
  return out;
}

/** 解析 GLB 容器，返回 dmapc 索引与 BIN 数据区。 */
export function unpackBundle(glb: Uint8Array): UnpackedBundle {
  if (glb.length < GLB_HEADER_BYTES) {
    throw new DmapFormatError('bad_bundle', 'GLB 载荷过短');
  }
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new DmapFormatError('bad_bundle', 'GLB magic 不正确');
  }
  if (view.getUint32(4, true) !== GLB_VERSION) {
    throw new DmapFormatError('bad_bundle', `不支持的 GLB 版本: ${view.getUint32(4, true)}`);
  }
  const totalLength = view.getUint32(8, true);
  if (totalLength !== glb.length) {
    throw new DmapFormatError(
      'bad_bundle',
      `GLB 总长度不一致: 声明 ${totalLength}，实际 ${glb.length}`,
    );
  }

  let jsonChunk: Uint8Array | null = null;
  let binChunk: Uint8Array | null = null;
  let cursor = GLB_HEADER_BYTES;
  while (cursor + CHUNK_HEADER_BYTES <= glb.length) {
    const chunkLength = view.getUint32(cursor, true);
    const chunkType = view.getUint32(cursor + 4, true);
    const dataStart = cursor + CHUNK_HEADER_BYTES;
    if (dataStart + chunkLength > glb.length) {
      throw new DmapFormatError('bad_bundle', 'GLB chunk 越界');
    }
    const chunk = glb.subarray(dataStart, dataStart + chunkLength);
    if (chunkType === CHUNK_TYPE_JSON && jsonChunk === null) {
      jsonChunk = chunk;
    } else if (chunkType === CHUNK_TYPE_BIN && binChunk === null) {
      binChunk = chunk;
    }
    cursor = dataStart + chunkLength;
  }

  if (jsonChunk === null) {
    throw new DmapFormatError('bad_bundle', '缺少 dmapc 索引 chunk');
  }
  if (binChunk === null) {
    throw new DmapFormatError('bad_bundle', '缺少数据 chunk');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(jsonChunk));
  } catch {
    throw new DmapFormatError('bad_bundle', 'dmapc 索引不是合法 JSON');
  }
  const entries = parseIndexEntries(parsed);

  return { entries, bin: binChunk };
}

function parseIndexEntries(parsed: unknown): DmapcIndexEntry[] {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new DmapFormatError('bad_bundle', 'dmapc 索引结构不正确');
  }
  const dmapc = (parsed as { dmapc?: unknown }).dmapc;
  if (typeof dmapc !== 'object' || dmapc === null) {
    throw new DmapFormatError('bad_bundle', 'dmapc 索引缺少 dmapc 字段');
  }
  const list = (dmapc as { entries?: unknown }).entries;
  if (!Array.isArray(list)) {
    throw new DmapFormatError('bad_bundle', 'dmapc 索引缺少 entries 数组');
  }
  return list.map((item, position) => {
    if (typeof item !== 'object' || item === null) {
      throw new DmapFormatError(`bad_bundle`, `索引第 ${position} 项结构不正确`);
    }
    const entry = item as Record<string, unknown>;
    const { name, mime, byteOffset, byteLength } = entry;
    if (typeof name !== 'string' || typeof mime !== 'string') {
      throw new DmapFormatError('bad_bundle', `索引第 ${position} 项缺少 name/mime`);
    }
    if (typeof byteOffset !== 'number' || typeof byteLength !== 'number') {
      throw new DmapFormatError('bad_bundle', `索引第 ${position} 项缺少 byteOffset/byteLength`);
    }
    return { name, mime, byteOffset, byteLength };
  });
}

/** 按名称取条目数据（BIN 区内的视图）。 */
export function readEntryData(bundle: UnpackedBundle, name: string): Uint8Array {
  const entry = bundle.entries.find((candidate) => candidate.name === name);
  if (entry === undefined) {
    throw new DmapEntryError(name);
  }
  const start = entry.byteOffset;
  const end = entry.byteOffset + entry.byteLength;
  if (end > bundle.bin.length) {
    throw new DmapFormatError('bad_bundle', `条目 ${name} 越出数据区`);
  }
  return bundle.bin.subarray(start, end);
}

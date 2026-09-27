import { DmapFormatError } from "./errors.js";

/**
 * 分片地图包清单（`dmap-map-manifest/3` 与 `/4`）。
 *
 * 一张地图的数据拆为多个 DMAP 容器随应用分发：
 * - **索引容器**（`index.dmap`）：本清单 + POI/配置/图标/2D 标定等轻量条目，
 *   先到先渲染 UI；
 * - **分块容器**（`chunks/c_<x>_<y>.dmap`，v4 起为 `chunks/c_<x>_<y>_l<N>.dmap`）：
 *   每个 3D 分块一个独立小容器，v4 起每个细节层级各一个容器，
 *   按清单 `chunks[].lods[].file` 惰性拉取；
 * - **导航容器**（`nav.dmap`，可选）：寻路网格，独立加载。
 *
 * v4 在 v3 之上仅为 chunks[] 增加逐层容器表 `lods[]`；其余字段语义不变，
 * 顶层规模字段恒为最高细节层（level 0）口径。本模块定义两个版本的运行时
 * 结构与解析校验；容器字节布局见 FORMAT.md。
 */

/** 清单在索引容器内的固定条目名。 */
export const MAP_MANIFEST_ENTRY = "manifest.json";
/** 最早的受支持清单格式标识。 */
export const MAP_MANIFEST_FORMAT_V3 = "dmap-map-manifest/3";
/** 当前清单格式标识（在 v3 之上增加 chunks[].lods 分层表）。 */
export const MAP_MANIFEST_FORMAT_V4 = "dmap-map-manifest/4";
/** 受支持的清单格式集合。 */
export const SUPPORTED_MAP_MANIFEST_FORMATS = [MAP_MANIFEST_FORMAT_V3, MAP_MANIFEST_FORMAT_V4];
/** 兼容别名：当前（最新）清单格式标识。 */
export const MAP_MANIFEST_FORMAT = MAP_MANIFEST_FORMAT_V4;

/** 分块容器内 GLB 载荷的固定条目名。 */
export const CHUNK_ENTRY_NAME = "chunk.glb";

/**
 * 清单 chunks[].lods[] 中的一条分层描述（v4）。
 * level 0 为最高细节层；数字越大细节越低。
 */
export interface DmapChunkLodRef {
  /** 细节层级（0 = 最高细节，随表内序严格递增）。 */
  readonly level: number;
  /** 该层分块容器路径，相对地图资产目录（如 `chunks/c_-25_-15_l1.dmap`）。 */
  readonly file: string;
  /** 该层是否由管线生成（level 0 为原始几何，恒 false）。 */
  readonly generated: boolean;
  readonly instances: number;
  readonly vertices: number;
  readonly triangles: number;
  readonly geometries: number;
  /** 原始 GLB 字节数（未压缩口径）。 */
  readonly bytes: number;
  /** 该层容器内实际 GLB 载荷字节数。 */
  readonly bytesCompressed: number;
  /** 密封后的该层容器文件字节数。 */
  readonly containerBytes: number;
  readonly boundsMin: readonly [number, number, number];
  readonly boundsMax: readonly [number, number, number];
}

/** 清单 chunks[] 中的一条分块描述。 */
export interface DmapChunkRef {
  /** 分块网格坐标标识（`<x>_<y>`）。 */
  readonly id: string;
  /** 最高细节层（level 0）容器路径，相对地图资产目录（如 `chunks/c_-25_-15_l0.dmap`）。 */
  readonly file: string;
  readonly instances: number;
  readonly vertices: number;
  readonly triangles: number;
  readonly geometries: number;
  /** 原始 GLB 字节数（未压缩口径，供规模展示）。 */
  readonly bytes: number;
  /** 分块容器内实际 GLB 载荷字节数。 */
  readonly bytesCompressed: number;
  /** 密封后的分块容器文件字节数（预取/进度估算用）。 */
  readonly containerBytes: number;
  readonly boundsMin: readonly [number, number, number];
  readonly boundsMax: readonly [number, number, number];
  /** 逐层容器表（v4；缺省 = v3 单层包，file 即唯一层级）。 */
  readonly lods?: readonly DmapChunkLodRef[];
}

/** 可按层取分块容器的最小入参形状（清单分块与引擎侧分块记录都结构化满足）。 */
export interface DmapChunkLodSource {
  /** 兜底容器路径（v3 单层包或表缺失时使用）。 */
  readonly file: string;
  /** 逐层表（level 升序；缺省 = 单层）。 */
  readonly lods?: readonly { readonly level: number; readonly file: string }[];
}

/** 索引容器内各类资产的条目路径。 */
export interface DmapMapManifestEntries {
  readonly scene: string;
  readonly poi: string;
  readonly map2d: string;
  readonly configs: readonly string[];
  readonly icons: string;
  readonly minimaps: string;
}

/** 一张地图的数据规模摘要。 */
export interface DmapMapCounts {
  readonly chunks: number;
  readonly instances: number;
  readonly vertices: number;
  readonly triangles: number;
  readonly geometries: number;
  readonly pois: number;
}

/** 解析后的单图清单（索引容器内 manifest.json 的运行时形态）。 */
export interface DmapMapManifest {
  readonly format: string;
  readonly map: { readonly mapId: number; readonly code: string };
  readonly floors: readonly number[];
  readonly counts: DmapMapCounts;
  readonly entries: DmapMapManifestEntries;
  readonly chunks: readonly DmapChunkRef[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function expectString(source: Record<string, unknown>, key: string, what: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new DmapFormatError("bad_manifest", `${what} 缺少字符串字段 ${key}`);
  }
  return value;
}

function expectNumber(source: Record<string, unknown>, key: string, what: string): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DmapFormatError("bad_manifest", `${what} 缺少数值字段 ${key}`);
  }
  return value;
}

function expectStringArray(source: Record<string, unknown>, key: string, what: string): string[] {
  const value = source[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new DmapFormatError("bad_manifest", `${what} 缺少字符串数组字段 ${key}`);
  }
  return value as string[];
}

function expectVec3(
  source: Record<string, unknown>,
  key: string,
  what: string,
): [number, number, number] {
  const value = source[key];
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((item) => typeof item !== "number" || !Number.isFinite(item))
  ) {
    throw new DmapFormatError("bad_manifest", `${what} 缺少三维坐标字段 ${key}`);
  }
  return [value[0], value[1], value[2]];
}

function parseCounts(source: Record<string, unknown>, what: string): DmapMapCounts {
  const counts = source.counts;
  if (!isObject(counts)) {
    throw new DmapFormatError("bad_manifest", `${what} 缺少 counts`);
  }
  return {
    chunks: expectNumber(counts, "chunks", `${what}.counts`),
    instances: expectNumber(counts, "instances", `${what}.counts`),
    vertices: expectNumber(counts, "vertices", `${what}.counts`),
    triangles: expectNumber(counts, "triangles", `${what}.counts`),
    geometries: expectNumber(counts, "geometries", `${what}.counts`),
    pois: expectNumber(counts, "pois", `${what}.counts`),
  };
}

function parseEntries(source: Record<string, unknown>, what: string): DmapMapManifestEntries {
  const entries = source.entries;
  if (!isObject(entries)) {
    throw new DmapFormatError("bad_manifest", `${what} 缺少 entries`);
  }
  return {
    scene: expectString(entries, "scene", `${what}.entries`),
    poi: expectString(entries, "poi", `${what}.entries`),
    map2d: expectString(entries, "map2d", `${what}.entries`),
    configs: expectStringArray(entries, "configs", `${what}.entries`),
    icons: expectString(entries, "icons", `${what}.entries`),
    minimaps: expectString(entries, "minimaps", `${what}.entries`),
  };
}

function parseChunkLods(item: Record<string, unknown>, label: string): DmapChunkLodRef[] {
  const list = item.lods;
  if (!Array.isArray(list) || list.length === 0) {
    throw new DmapFormatError("bad_manifest", `${label} 缺少非空 lods 数组`);
  }
  return list.map((entry, position) => {
    if (!isObject(entry)) {
      throw new DmapFormatError("bad_manifest", `${label}.lods[${position}] 结构不正确`);
    }
    const lodLabel = `${label}.lods[${position}]`;
    const level = expectNumber(entry, "level", lodLabel);
    if (!Number.isInteger(level) || level < 0) {
      throw new DmapFormatError("bad_manifest", `${lodLabel} level 必须为非负整数`);
    }
    if (position > 0 && level <= list[position - 1]!.level) {
      throw new DmapFormatError("bad_manifest", `${lodLabel} level 未严格递增`);
    }
    const generated = entry.generated;
    if (typeof generated !== "boolean") {
      throw new DmapFormatError("bad_manifest", `${lodLabel} 缺少布尔字段 generated`);
    }
    return {
      level,
      file: expectString(entry, "file", lodLabel),
      generated,
      instances: expectNumber(entry, "instances", lodLabel),
      vertices: expectNumber(entry, "vertices", lodLabel),
      triangles: expectNumber(entry, "triangles", lodLabel),
      geometries: expectNumber(entry, "geometries", lodLabel),
      bytes: expectNumber(entry, "bytes", lodLabel),
      bytesCompressed: expectNumber(entry, "bytesCompressed", lodLabel),
      containerBytes: expectNumber(entry, "containerBytes", lodLabel),
      boundsMin: expectVec3(entry, "boundsMin", lodLabel),
      boundsMax: expectVec3(entry, "boundsMax", lodLabel),
    };
  });
}

function parseChunks(
  source: Record<string, unknown>,
  what: string,
  requireLods: boolean,
): DmapChunkRef[] {
  const list = source.chunks;
  if (!Array.isArray(list) || list.length === 0) {
    throw new DmapFormatError("bad_manifest", `${what} 缺少非空 chunks 数组`);
  }
  return list.map((item, position) => {
    if (!isObject(item)) {
      throw new DmapFormatError("bad_manifest", `chunks[${position}] 结构不正确`);
    }
    const label = `chunks[${position}]`;
    const chunk: DmapChunkRef = {
      id: expectString(item, "id", label),
      file: expectString(item, "file", label),
      instances: expectNumber(item, "instances", label),
      vertices: expectNumber(item, "vertices", label),
      triangles: expectNumber(item, "triangles", label),
      geometries: expectNumber(item, "geometries", label),
      bytes: expectNumber(item, "bytes", label),
      bytesCompressed: expectNumber(item, "bytesCompressed", label),
      containerBytes: expectNumber(item, "containerBytes", label),
      boundsMin: expectVec3(item, "boundsMin", label),
      boundsMax: expectVec3(item, "boundsMax", label),
    };
    if (item.lods !== undefined || requireLods) {
      const lods = parseChunkLods(item, label);
      if (lods[0]!.level !== 0) {
        throw new DmapFormatError("bad_manifest", `${label}.lods 缺少 level 0（最高细节层）`);
      }
      return { ...chunk, lods };
    }
    return chunk;
  });
}

/**
 * 解析并校验 dmap-map-manifest/3 或 /4 清单；格式不符抛 `bad_manifest` 的 DmapFormatError。
 * v4 要求每个分块携带非空 lods 分层表（level 自 0 起严格递增）。
 */
export function parseMapManifest(raw: unknown): DmapMapManifest {
  if (!isObject(raw)) {
    throw new DmapFormatError("bad_manifest", "清单必须是 JSON 对象");
  }
  if (!SUPPORTED_MAP_MANIFEST_FORMATS.includes(raw.format as string)) {
    throw new DmapFormatError(
      "bad_manifest",
      `清单 format 不受支持: ${String(raw.format)}（当前支持 ${SUPPORTED_MAP_MANIFEST_FORMATS.join("、")}）`,
    );
  }
  const format = raw.format as string;
  const map = raw.map;
  if (!isObject(map)) {
    throw new DmapFormatError("bad_manifest", "清单缺少 map");
  }
  const mapId = expectNumber(map, "mapId", "map");
  const code = expectString(map, "code", "map");
  const floors = raw.floors;
  if (
    !Array.isArray(floors) ||
    floors.length === 0 ||
    floors.some((item) => typeof item !== "number")
  ) {
    throw new DmapFormatError("bad_manifest", "清单 floors 必须为非空数值数组");
  }
  return {
    format,
    map: { mapId, code },
    floors,
    counts: parseCounts(raw, "清单"),
    entries: parseEntries(raw, "清单"),
    chunks: parseChunks(raw, "清单", format === MAP_MANIFEST_FORMAT_V4),
  };
}

/**
 * 按细节层级解析分块容器路径。
 *
 * - 无分层表（v3 单层包）：任意 level 均回落 `chunk.file`；
 * - 有分层表：取 level 恰等于请求值的层；请求值超出表范围时取最接近的
 *   更细层（level 更小）——请求更粗而不可得时贴最高可得细节，
 *   请求更细时回落 level 0。
 */
export function chunkLodFile(chunk: DmapChunkLodSource, level: number): string {
  const lods = chunk.lods;
  if (lods === undefined || lods.length === 0) {
    return chunk.file;
  }
  let best = lods[0]!;
  for (const lod of lods) {
    if (lod.level <= level) {
      best = lod;
    } else {
      break;
    }
  }
  return best.file;
}

import { DmapFormatError } from "./errors.js";

/**
 * 分片地图包清单（`dmap-map-manifest/3`）。
 *
 * 一张地图的数据拆为多个 DMAP 容器随应用分发：
 * - **索引容器**（`index.dmap`）：本清单 + POI/配置/图标/2D 标定等轻量条目，
 *   先到先渲染 UI；
 * - **分块容器**（`chunks/c_<x>_<y>.dmap`）：每个 3D 分块一个独立小容器，
 *   按清单 `chunks[].file` 惰性拉取；
 * - **导航容器**（`nav.dmap`，可选）：寻路网格，独立加载。
 *
 * 本模块定义 v3 清单的运行时结构与解析校验；容器字节布局见 FORMAT.md。
 */

/** 清单在索引容器内的固定条目名。 */
export const MAP_MANIFEST_ENTRY = "manifest.json";
/** 当前清单格式标识。 */
export const MAP_MANIFEST_FORMAT = "dmap-map-manifest/3";

/** 分块容器内 GLB 载荷的固定条目名。 */
export const CHUNK_ENTRY_NAME = "chunk.glb";

/** 清单 chunks[] 中的一条分块描述。 */
export interface DmapChunkRef {
  /** 分块网格坐标标识（`<x>_<y>`）。 */
  readonly id: string;
  /** 分块容器路径，相对地图资产目录（如 `chunks/c_-25_-15.dmap`）。 */
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

function parseChunks(source: Record<string, unknown>, what: string): DmapChunkRef[] {
  const list = source.chunks;
  if (!Array.isArray(list) || list.length === 0) {
    throw new DmapFormatError("bad_manifest", `${what} 缺少非空 chunks 数组`);
  }
  return list.map((item, position) => {
    if (!isObject(item)) {
      throw new DmapFormatError("bad_manifest", `chunks[${position}] 结构不正确`);
    }
    const label = `chunks[${position}]`;
    return {
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
  });
}

/**
 * 解析并校验 dmap-map-manifest/3 清单；格式不符抛 `bad_manifest` 的 DmapFormatError。
 */
export function parseMapManifest(raw: unknown): DmapMapManifest {
  if (!isObject(raw)) {
    throw new DmapFormatError("bad_manifest", "清单必须是 JSON 对象");
  }
  if (raw.format !== MAP_MANIFEST_FORMAT) {
    throw new DmapFormatError(
      "bad_manifest",
      `清单 format 不受支持: ${String(raw.format)}（当前支持 ${MAP_MANIFEST_FORMAT}）`,
    );
  }
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
    format: MAP_MANIFEST_FORMAT,
    map: { mapId, code },
    floors,
    counts: parseCounts(raw, "清单"),
    entries: parseEntries(raw, "清单"),
    chunks: parseChunks(raw, "清单"),
  };
}

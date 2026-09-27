import type { Vec3 } from "@/common/geometry";

/**
 * chunk 空间分桶与调度（纯逻辑，无 three 依赖，可独立单测）。
 *
 * 摆放表的分区字段为空，管线侧按固定网格（128m）自建分桶导出 chunk；
 * 运行时以 chunk 的世界包围盒做视锥相交 + 渲染半径两级筛选：
 * 命中即加载，离开「半径 + 迟滞带」才卸载，避免边界抖动反复加载。
 *
 * LOD 分带（dmap-map-manifest/4 分层包）：保留集内每个 chunk 按其中心到
 * 检测中心的距离分带决定期望细节层级（近细远粗），带边界施加迟滞余量
 * （当前层维持到越界 ± margin）防止相机抖动时反复换层。
 */

/** 视锥平面：n·p + d ≥ 0 为内侧（three Frustum.planes 同约定）。 */
export type FrustumPlane = readonly [nx: number, ny: number, nz: number, d: number];
export type FrustumPlanes = readonly FrustumPlane[];

/** 清单 chunks[].lods[] 中引擎侧需要的最小形状。 */
export interface ChunkLodInfo {
  readonly level: number;
  readonly file: string;
}

/** 数据包清单 chunks[] 中的一条 chunk 元数据。 */
export interface ChunkInfo {
  readonly id: string;
  /** 最高细节层（level 0）容器路径（相对地图资产目录，如 chunks/c_-25_-15_l0.dmap）。 */
  readonly file: string;
  readonly instances: number;
  readonly boundsMin: readonly [number, number, number];
  readonly boundsMax: readonly [number, number, number];
  /** 逐层容器表（v4 分层包；缺省 = 单层包，任意层级均回落 file）。 */
  readonly lods?: readonly ChunkLodInfo[];
}

/** 运行时 chunk 索引项。 */
export interface ChunkRecord extends ChunkInfo {
  readonly center: Vec3;
  /** 包围盒对角线半径（保守值，含实例姿态扩展）。 */
  readonly radius: number;
  /** 是否携带可切换的多层容器表（单层包恒 false，期望层级恒 0）。 */
  readonly hasLodTiers: boolean;
}

/** LOD 分带阈值（米，升序）：d < t[0] → 层 0；t[0] ≤ d < t[1] → 层 1；d ≥ t[1] → 层 2。 */
export type LodThresholds = readonly [number, number];

export interface LodBands {
  /** 分带阈值（米，升序正数）。 */
  readonly thresholds: LodThresholds;
  /** 迟滞余量（米）：带边界 ± margin 内维持当前层。 */
  readonly hysteresis: number;
}

export interface SelectChunksOptions {
  /** 候选 chunk（全部或未加载子集）。 */
  readonly chunks: readonly ChunkRecord[];
  /** 相机视锥的 6 平面（省略时退化为纯半径判定）。 */
  readonly planes?: FrustumPlanes;
  /** 检测中心（通常为相机位置或轨道目标点）。 */
  readonly center: Vec3;
  /** 渲染半径（米）：中心到包围盒最近点距离小于该值才加载。 */
  readonly radius: number;
  /** 迟滞余量（米）：已加载 chunk 的保留半径 = radius + hysteresis。 */
  readonly hysteresis?: number;
  /** 已加载 chunk 集合，用于按迟滞带保留。 */
  readonly loadedIds?: ReadonlySet<string>;
  /** LOD 分带（省略时保留集期望层级恒 0）。 */
  readonly lod?: LodBands;
  /** 当前已挂载层级（chunk id → level），分带迟滞判定用；未挂载的 chunk 不传。 */
  readonly currentLevels?: ReadonlyMap<string, number>;
}

export interface SelectChunksResult {
  readonly toLoad: readonly ChunkRecord[];
  readonly toUnload: readonly string[];
  /** 保留集（已载 + 待载）的期望细节层级：chunk id → level。 */
  readonly desiredLevels: ReadonlyMap<string, number>;
}

/** 由 manifest.chunkBounds 构建运行时索引。 */
export function buildChunkRecords(infos: readonly ChunkInfo[]): ChunkRecord[] {
  return infos.map((info) => {
    const min = info.boundsMin;
    const max = info.boundsMax;
    const center: Vec3 = {
      x: (min[0] + max[0]) / 2,
      y: (min[1] + max[1]) / 2,
      z: (min[2] + max[2]) / 2,
    };
    const dx = max[0] - min[0];
    const dy = max[1] - min[1];
    const dz = max[2] - min[2];
    return {
      ...info,
      center,
      radius: Math.sqrt(dx * dx + dy * dy + dz * dz) / 2,
      hasLodTiers: info.lods !== undefined && info.lods.length > 1,
    };
  });
}

/** 点到 AABB 最近点距离的平方（点在盒内时为 0）。 */
export function distanceSqToPointAabb(point: Vec3, min: Vec3, max: Vec3): number {
  const dx = Math.max(min.x - point.x, 0, point.x - max.x);
  const dy = Math.max(min.y - point.y, 0, point.y - max.y);
  const dz = Math.max(min.z - point.z, 0, point.z - max.z);
  return dx * dx + dy * dy + dz * dz;
}

/**
 * AABB 与视锥相交判定（无精确裁剪需求，宁可误留不可误删）：
 * 对每个平面取「正向最远角」做快速拒绝。
 */
export function aabbIntersectsFrustum(min: Vec3, max: Vec3, planes: FrustumPlanes): boolean {
  for (const plane of planes) {
    const [nx, ny, nz, d] = plane;
    const px = nx >= 0 ? max.x : min.x;
    const py = ny >= 0 ? max.y : min.y;
    const pz = nz >= 0 ? max.z : min.z;
    if (nx * px + ny * py + nz * pz + d < 0) {
      return false;
    }
  }
  return true;
}

/** 纯距离分带（无迟滞视角）：d < t[0] → 0；t[0] ≤ d < t[1] → 1；d ≥ t[1] → 2。 */
function bandOfDistance(distance: number, thresholds: LodThresholds): number {
  if (distance < thresholds[0]) {
    return 0;
  }
  return distance < thresholds[1] ? 1 : 2;
}

/**
 * 按距离与当前层决定期望细节层级（Schmitt 触发器）：
 *
 * - 无当前层（首载）：纯分带；
 * - 距离落在当前层的带内：维持当前层；
 * - 升层（更细，level 变小）：需越过下方带边界 − 迟滞（d < thresholds[c-1] − m）；
 * - 降层（更粗，level 变大）：需越出上方带边界 + 迟滞（d ≥ thresholds[c] + m）。
 *
 * 两侧迟滞使带边界附近的小幅抖动不触发换层。
 */
export function lodLevelForDistance(
  distance: number,
  bands: LodBands,
  currentLevel?: number,
): number {
  const plain = bandOfDistance(distance, bands.thresholds);
  if (currentLevel === undefined || plain === currentLevel) {
    return plain;
  }
  if (plain < currentLevel) {
    // 升层判定：越过当前层下边界（减迟滞）才放行到纯分带结果。
    const boundary = bands.thresholds[currentLevel - 1];
    return boundary !== undefined && distance < boundary - bands.hysteresis ? plain : currentLevel;
  }
  // 降层判定：越出当前层上边界（加迟滞）才放行到纯分带结果。
  const boundary = bands.thresholds[currentLevel];
  return boundary !== undefined && distance >= boundary + bands.hysteresis ? plain : currentLevel;
}

/** 加载筛选：视锥内且在渲染半径内；卸载筛选：离开渲染半径 + 迟滞带或视锥。 */
export function selectChunks(options: SelectChunksOptions): SelectChunksResult {
  const { chunks, planes, center, radius } = options;
  const hysteresis = options.hysteresis ?? radius * 0.25;
  const loadedIds = options.loadedIds;
  const radiusSq = radius * radius;
  const keepSq = (radius + hysteresis) * (radius + hysteresis);
  const lod = options.lod;
  const currentLevels = options.currentLevels;

  const toLoad: ChunkRecord[] = [];
  const toUnload: string[] = [];
  const desiredLevels = new Map<string, number>();

  for (const chunk of chunks) {
    const min: Vec3 = {
      x: chunk.boundsMin[0],
      y: chunk.boundsMin[1],
      z: chunk.boundsMin[2],
    };
    const max: Vec3 = {
      x: chunk.boundsMax[0],
      y: chunk.boundsMax[1],
      z: chunk.boundsMax[2],
    };
    const distanceSq = distanceSqToPointAabb(center, min, max);
    const isLoaded = loadedIds?.has(chunk.id) ?? false;
    const keepRadiusSq = isLoaded ? keepSq : radiusSq;

    if (distanceSq > keepRadiusSq) {
      if (isLoaded) {
        toUnload.push(chunk.id);
      }
      continue;
    }
    if (planes !== undefined && !aabbIntersectsFrustum(min, max, planes)) {
      if (isLoaded) {
        toUnload.push(chunk.id);
      }
      continue;
    }
    if (!isLoaded) {
      toLoad.push(chunk);
    }
    // 保留集内按中心距离分带（LOD 缺省恒 0 层）。
    desiredLevels.set(
      chunk.id,
      lod === undefined
        ? 0
        : lodLevelForDistance(distanceToChunk(center, chunk), lod, currentLevels?.get(chunk.id)),
    );
  }

  return { toLoad, toUnload, desiredLevels };
}

/** 检测中心到 chunk 中心的欧氏距离（LOD 分带口径）。 */
export function distanceToChunk(center: Vec3, chunk: Pick<ChunkRecord, "center">): number {
  const dx = chunk.center.x - center.x;
  const dy = chunk.center.y - center.y;
  const dz = chunk.center.z - center.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** 按「中心距离（AABB 最近点）」升序排序，用于加载队列优先级。 */
export function sortByDistance(chunks: readonly ChunkRecord[], center: Vec3): ChunkRecord[] {
  return chunks.toSorted((a, b) => {
    const da = distanceSqToPointAabb(center, a.center, a.center);
    const db = distanceSqToPointAabb(center, b.center, b.center);
    return da - db;
  });
}

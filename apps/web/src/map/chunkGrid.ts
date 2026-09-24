import type { Vec3 } from '@/common/geometry';

/**
 * chunk 空间分桶与调度（纯逻辑，无 three 依赖，可独立单测）。
 *
 * 摆放表的分区字段为空，管线侧按固定网格（128m）自建分桶导出 chunk；
 * 运行时以 chunk 的世界包围盒做视锥相交 + 渲染半径两级筛选：
 * 命中即加载，离开「半径 + 迟滞带」才卸载，避免边界抖动反复加载。
 */

/** 视锥平面：n·p + d ≥ 0 为内侧（three Frustum.planes 同约定）。 */
export type FrustumPlane = readonly [nx: number, ny: number, nz: number, d: number];
export type FrustumPlanes = readonly FrustumPlane[];

/** 数据包 manifest.chunkBounds 中的一条 chunk 元数据。 */
export interface ChunkInfo {
  readonly id: string;
  readonly file: string;
  /** 所属容器序号（manifest.containers 下标）。 */
  readonly container: number;
  readonly boundsMin: readonly [number, number, number];
  readonly boundsMax: readonly [number, number, number];
}

/** 运行时 chunk 索引项。 */
export interface ChunkRecord extends ChunkInfo {
  readonly center: Vec3;
  /** 包围盒对角线半径（保守值，含实例姿态扩展）。 */
  readonly radius: number;
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
}

export interface SelectChunksResult {
  readonly toLoad: readonly ChunkRecord[];
  readonly toUnload: readonly string[];
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
    return { ...info, center, radius: Math.sqrt(dx * dx + dy * dy + dz * dz) / 2 };
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
export function aabbIntersectsFrustum(
  min: Vec3,
  max: Vec3,
  planes: FrustumPlanes,
): boolean {
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

/** 加载筛选：视锥内且在渲染半径内；卸载筛选：离开渲染半径 + 迟滞带或视锥。 */
export function selectChunks(options: SelectChunksOptions): SelectChunksResult {
  const { chunks, planes, center, radius } = options;
  const hysteresis = options.hysteresis ?? radius * 0.25;
  const loadedIds = options.loadedIds;
  const radiusSq = radius * radius;
  const keepSq = (radius + hysteresis) * (radius + hysteresis);

  const toLoad: ChunkRecord[] = [];
  const toUnload: string[] = [];

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
  }

  return { toLoad, toUnload };
}

/** 按「中心距离（AABB 最近点）」升序排序，用于加载队列优先级。 */
export function sortByDistance(
  chunks: readonly ChunkRecord[],
  center: Vec3,
): ChunkRecord[] {
  return [...chunks].sort((a, b) => {
    const da = distanceSqToPointAabb(center, a.center, a.center);
    const db = distanceSqToPointAabb(center, b.center, b.center);
    return da - db;
  });
}

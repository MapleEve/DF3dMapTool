import type { Vec3 } from "@/common/geometry";
import { buildNavmeshData, type NavmeshData } from "./navmeshData";

/**
 * 导航网格数据文档（数据包内中性键，管线转换产物）。
 * 顶点为工具世界系 float32(x,y,z) 的 base64；多边形为 uint32 三角形索引流的 base64。
 */
export interface NavmeshDoc {
  readonly format: string;
  readonly mapCode: string;
  readonly agentRadius: number;
  readonly bounds: { readonly min: readonly number[]; readonly max: readonly number[] };
  readonly vertexCount: number;
  readonly polygonCount: number;
  readonly vertexData: string;
  readonly polygonData: string;
}

export const NAVMESH_FORMAT = "df3d-navmesh/1";

/** 最近点查询结果。 */
export interface NavPoint {
  readonly point: Vec3;
  readonly polyIndex: number;
}

/** 寻路结果：途经点序列与总长度（米）。 */
export interface NavPath {
  readonly points: readonly Vec3[];
  readonly distance: number;
}

const CELL_SIZE = 32; // 与构建侧一致（navmeshData.ts）

function decodeBase64Bytes(base64: string): Uint8Array {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

/** 三维点到三角形最近点（标准 Ericson 算法）。 */
function closestPointOnTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const acz = c.z - a.z;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const apz = p.z - a.z;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) {
    return a;
  }
  const bpx = p.x - b.x;
  const bpy = p.y - b.y;
  const bpz = p.z - b.z;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) {
    return b;
  }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return { x: a.x + abx * v, y: a.y + aby * v, z: a.z + abz * v };
  }
  const cpx = p.x - c.x;
  const cpy = p.y - c.y;
  const cpz = p.z - c.z;
  const d5 = acx * cpx + acy * cpy + acz * cpz;
  const d6 = abx * cpx + aby * cpy + abz * cpz;
  if (d6 >= 0 && d5 <= d6) {
    return c;
  }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return { x: a.x + acx * w, y: a.y + acy * w, z: a.z + acz * w };
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return {
      x: b.x + (c.x - b.x) * w,
      y: b.y + (c.y - b.y) * w,
      z: b.z + (c.z - b.z) * w,
    };
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return {
    x: a.x + abx * v + acx * w,
    y: a.y + aby * v + acy * w,
    z: a.z + abz * v + acz * w,
  };
}

function distanceOf(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function midOf(a: Vec3, b: Vec3): Vec3 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

/** 二叉最小堆（A* 开放集）。 */
class MinHeap {
  readonly #items: number[] = [];
  readonly #keys: number[] = [];

  get size(): number {
    return this.#items.length;
  }

  push(item: number, key: number): void {
    this.#items.push(item);
    this.#keys.push(key);
    let i = this.#items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.#keys[parent] <= this.#keys[i]) {
        break;
      }
      this.#swap(i, parent);
      i = parent;
    }
  }

  pop(): number | undefined {
    const top = this.#items[0];
    const lastItem = this.#items.pop();
    const lastKey = this.#keys.pop();
    if (this.#items.length > 0 && lastItem !== undefined && lastKey !== undefined) {
      this.#items[0] = lastItem;
      this.#keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.#items.length && this.#keys[left] < this.#keys[smallest]) {
          smallest = left;
        }
        if (right < this.#items.length && this.#keys[right] < this.#keys[smallest]) {
          smallest = right;
        }
        if (smallest === i) {
          break;
        }
        this.#swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  #swap(i: number, j: number): void {
    [this.#items[i], this.#items[j]] = [this.#items[j], this.#items[i]];
    [this.#keys[i], this.#keys[j]] = [this.#keys[j], this.#keys[i]];
  }
}

/**
 * 导航网格查询：三角形邻接图上的最近点与 A* 实时寻路。
 * 数据为可转移 TypedArray（NavmeshData，构建见 navmeshData.ts / navmeshWorker.ts）：
 * Worker 构建产物与本线程构建产物结构一致，查询结果一致（测试覆盖）。
 */
export class NavMesh {
  readonly #data: NavmeshData;

  constructor(data: NavmeshData) {
    this.#data = data;
  }

  get triangleCount(): number {
    return this.#data.triangleCount;
  }

  #vertexAt(index: number): Vec3 {
    return {
      x: this.#data.vertices[index * 3],
      y: this.#data.vertices[index * 3 + 1],
      z: this.#data.vertices[index * 3 + 2],
    };
  }

  #triangleVerts(t: number): { a: Vec3; b: Vec3; c: Vec3 } {
    const d = this.#data;
    return {
      a: this.#vertexAt(d.triVerts[t * 3]),
      b: this.#vertexAt(d.triVerts[t * 3 + 1]),
      c: this.#vertexAt(d.triVerts[t * 3 + 2]),
    };
  }

  #centroid(t: number): Vec3 {
    const d = this.#data;
    return { x: d.centroids[t * 3], y: d.centroids[t * 3 + 1], z: d.centroids[t * 3 + 2] };
  }

  /** 均匀网格键 → 桶（cellKeys 升序，二分查找）。 */
  #cellBucket(key: number): number[] | null {
    const d = this.#data;
    let lo = 0;
    let hi = d.cellKeys.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const value = d.cellKeys[mid];
      if (value === key) {
        const start = d.cellBucketOffset[mid];
        const end = d.cellBucketOffset[mid + 1];
        return Array.from(d.cellBuckets.subarray(start, end));
      }
      if (value < key) {
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return null;
  }

  /** 最近可走点：先查网格邻域三角形，取三维最近点。 */
  nearestPoint(p: Vec3): NavPoint | null {
    if (this.#data.triangleCount === 0) {
      return null;
    }
    const cx = Math.floor((p.x - this.#data.cellMinX) / CELL_SIZE);
    const cz = Math.floor((p.z - this.#data.cellMinZ) / CELL_SIZE);
    let best: NavPoint | null = null;
    let bestDist = Infinity;
    // 由近及外扩环搜索；找到结果后再查一圈避免边界遗漏
    for (let radius = 0; radius <= 8; radius += 1) {
      if (best !== null && radius > 0 && bestDist <= radius * CELL_SIZE) {
        break;
      }
      for (let dz = -radius; dz <= radius; dz += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) {
            continue;
          }
          const bucket = this.#cellBucket((cz + dz) * this.#data.cellCols + (cx + dx));
          if (bucket === null) {
            continue;
          }
          for (const t of bucket) {
            const { a, b, c } = this.#triangleVerts(t);
            const point = closestPointOnTriangle(p, a, b, c);
            const d = distanceOf(p, point);
            if (d < bestDist) {
              bestDist = d;
              best = { point, polyIndex: t };
            }
          }
        }
      }
    }
    return best;
  }

  /**
   * A* 实时寻路：三角形邻接图上按共享边中点代价搜索，
   * 途经点为起点、各 portal 边中点与终点（直线串点，未做漏斗平滑）。
   */
  findPath(from: Vec3, to: Vec3): NavPath | null {
    const start = this.nearestPoint(from);
    const goal = this.nearestPoint(to);
    if (start === null || goal === null) {
      return null;
    }
    const startTri = start.polyIndex;
    const goalTri = goal.polyIndex;
    if (startTri === goalTri) {
      return { points: [start.point, goal.point], distance: distanceOf(start.point, goal.point) };
    }

    const cameFrom = new Map<number, number>();
    const gScore = new Map<number, number>([[startTri, 0]]);
    const closed = new Set<number>();
    const goalPoint = goal.point;
    const heuristic = (tri: number): number => distanceOf(this.#centroid(tri), goalPoint);
    const open = new MinHeap();
    open.push(startTri, heuristic(startTri));

    let found = false;
    while (open.size > 0) {
      const current = open.pop();
      if (current === undefined || closed.has(current)) {
        continue;
      }
      if (current === goalTri) {
        found = true;
        break;
      }
      closed.add(current);
      const currentCentroid = this.#centroid(current);
      const currentG = gScore.get(current) ?? Infinity;
      const d = this.#data;
      const neighborStart = d.neighborsOffset[current];
      const neighborEnd = d.neighborsOffset[current + 1];
      for (let n = neighborStart; n < neighborEnd; n += 1) {
        const next = d.neighbors[n];
        if (closed.has(next)) {
          continue;
        }
        // 代价 = 穿过共享边（portal）中点的路程：当前三角形中心 → 边中点 → 下一三角形中心
        const portal = this.#portalMid(current, next);
        const stepCost =
          distanceOf(currentCentroid, portal) + distanceOf(portal, this.#centroid(next));
        const tentative = currentG + stepCost;
        if (tentative < (gScore.get(next) ?? Infinity)) {
          gScore.set(next, tentative);
          cameFrom.set(next, current);
          open.push(next, tentative + heuristic(next));
        }
      }
    }
    if (!found) {
      return null;
    }

    // 回溯三角形链 → portal 边中点串点
    const chain: number[] = [goalTri];
    let cursor = goalTri;
    while (cursor !== startTri) {
      const prev = cameFrom.get(cursor);
      if (prev === undefined) {
        return null;
      }
      chain.push(prev);
      cursor = prev;
    }
    chain.reverse();

    const points: Vec3[] = [start.point];
    for (let i = 0; i < chain.length - 1; i += 1) {
      points.push(this.#portalMid(chain[i], chain[i + 1]));
    }
    points.push(goal.point);
    let distance = 0;
    for (let i = 0; i < points.length - 1; i += 1) {
      distance += distanceOf(points[i], points[i + 1]);
    }
    return { points, distance };
  }

  /** 两相邻三角形共享边（portal）中点；按顶点索引求交。 */
  #portalMid(a: number, b: number): Vec3 {
    const d = this.#data;
    const av = [d.triVerts[a * 3], d.triVerts[a * 3 + 1], d.triVerts[a * 3 + 2]];
    const bv = [d.triVerts[b * 3], d.triVerts[b * 3 + 1], d.triVerts[b * 3 + 2]];
    const shared: number[] = [];
    for (const p of av) {
      if (bv.includes(p) && !shared.includes(p)) {
        shared.push(p);
      }
    }
    if (shared.length >= 2) {
      return midOf(this.#vertexAt(shared[0]), this.#vertexAt(shared[1]));
    }
    if (shared.length === 1) {
      return this.#vertexAt(shared[0]);
    }
    return midOf(this.#centroid(a), this.#centroid(b));
  }
}

/** 解析导航网格数据文档（主线程同步构建）；格式不符或数据为空返回 null。 */
export function navMeshFromDoc(doc: NavmeshDoc): NavMesh | null {
  if (doc.format !== NAVMESH_FORMAT) {
    throw new RangeError(`导航数据 format 应为 ${NAVMESH_FORMAT}`);
  }
  const { vertices, indices } = decodeNavmeshDoc(doc);
  if (vertices.length === 0 || indices.length === 0) {
    return null;
  }
  for (let i = 0; i < indices.length; i += 1) {
    if (indices[i] >= vertices.length / 3) {
      throw new RangeError(`导航数据顶点索引越界: ${indices[i]}`);
    }
  }
  return new NavMesh(buildNavmeshData(vertices, indices));
}

/** 文档 base64 载荷 → 顶点/索引 TypedArray（Worker 与主线程共用）。 */
export function decodeNavmeshDoc(doc: NavmeshDoc): {
  vertices: Float32Array;
  indices: Uint32Array;
} {
  const vertexBytes = decodeBase64Bytes(doc.vertexData);
  const polygonBytes = decodeBase64Bytes(doc.polygonData);
  const vertices = new Float32Array(
    vertexBytes.buffer,
    vertexBytes.byteOffset,
    vertexBytes.byteLength / 4,
  );
  const indices = new Uint32Array(
    polygonBytes.buffer,
    polygonBytes.byteOffset,
    polygonBytes.byteLength / 4,
  );
  return { vertices, indices };
}

export type { NavmeshData };
export { buildNavmeshData };

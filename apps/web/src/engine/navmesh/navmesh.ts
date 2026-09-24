import type { Vec3 } from '@/common/geometry';

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

export const NAVMESH_FORMAT = 'df3d-navmesh/1';

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

interface Triangle {
  readonly ia: number;
  readonly ib: number;
  readonly ic: number;
  readonly a: Vec3;
  readonly b: Vec3;
  readonly c: Vec3;
  readonly centroid: Vec3;
  readonly neighbors: number[];
}

const CELL_SIZE = 32; // 点定位均匀网格边长（米）
const EDGE_QUANT = 1000; // 共享边匹配的坐标量化精度（1/m）

function decodeBase64Bytes(base64: string): Uint8Array {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

function edgeKey(p: Vec3, q: Vec3): string {
  const ax = Math.round(p.x * EDGE_QUANT);
  const ay = Math.round(p.y * EDGE_QUANT);
  const az = Math.round(p.z * EDGE_QUANT);
  const bx = Math.round(q.x * EDGE_QUANT);
  const by = Math.round(q.y * EDGE_QUANT);
  const bz = Math.round(q.z * EDGE_QUANT);
  // 按坐标字典序归一化方向，保证 (a,b) 与 (b,a) 同键
  const forward = ax < bx || (ax === bx && (ay < by || (ay === by && az <= bz)));
  const [s, t] = forward ? [p, q] : [q, p];
  return `${s.x.toFixed(3)},${s.y.toFixed(3)},${s.z.toFixed(3)}|${t.x.toFixed(3)},${t.y.toFixed(3)},${t.z.toFixed(3)}`;
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
 * 导航网格：三角形邻接图 + A* 实时寻路。
 * 数据来自管线转换产物（加密容器内中性 JSON 文档）。
 */
export class NavMesh {
  readonly #triangles: Triangle[] = [];
  readonly #vertices: Float32Array;
  readonly #cells = new Map<number, number[]>();
  readonly #cellMinX: number;
  readonly #cellMinZ: number;
  readonly #cellCols: number;

  constructor(vertices: Float32Array, indices: Uint32Array) {
    this.#vertices = vertices;
    const vertexAt = (i: number): Vec3 => ({
      x: vertices[i * 3],
      y: vertices[i * 3 + 1],
      z: vertices[i * 3 + 2],
    });

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let t = 0; t < indices.length; t += 3) {
      const ia = indices[t];
      const ib = indices[t + 1];
      const ic = indices[t + 2];
      const a = vertexAt(ia);
      const b = vertexAt(ib);
      const c = vertexAt(ic);
      const centroid = {
        x: (a.x + b.x + c.x) / 3,
        y: (a.y + b.y + c.y) / 3,
        z: (a.z + b.z + c.z) / 3,
      };
      this.#triangles.push({ ia, ib, ic, a, b, c, centroid, neighbors: [] });
      minX = Math.min(minX, a.x, b.x, c.x);
      maxX = Math.max(maxX, a.x, b.x, c.x);
      minZ = Math.min(minZ, a.z, b.z, c.z);
      maxZ = Math.max(maxZ, a.z, b.z, c.z);
    }

    this.#cellMinX = minX - 1;
    this.#cellMinZ = minZ - 1;
    this.#cellCols = Math.max(1, Math.ceil((maxX - minX + 2) / CELL_SIZE));
    for (let t = 0; t < this.#triangles.length; t += 1) {
      const { a, b, c } = this.#triangles[t];
      const cx0 = Math.floor((Math.min(a.x, b.x, c.x) - this.#cellMinX) / CELL_SIZE);
      const cx1 = Math.floor((Math.max(a.x, b.x, c.x) - this.#cellMinX) / CELL_SIZE);
      const cz0 = Math.floor((Math.min(a.z, b.z, c.z) - this.#cellMinZ) / CELL_SIZE);
      const cz1 = Math.floor((Math.max(a.z, b.z, c.z) - this.#cellMinZ) / CELL_SIZE);
      for (let cz = cz0; cz <= cz1; cz += 1) {
        for (let cx = cx0; cx <= cx1; cx += 1) {
          const key = cz * this.#cellCols + cx;
          const bucket = this.#cells.get(key);
          if (bucket === undefined) {
            this.#cells.set(key, [t]);
          } else {
            bucket.push(t);
          }
        }
      }
    }

    // 共享边 → 邻接（按量化坐标匹配，跨 tile 的重复顶点天然对齐）
    const edgeMap = new Map<string, number[]>();
    for (let t = 0; t < this.#triangles.length; t += 1) {
      const { a, b, c } = this.#triangles[t];
      for (const [p, q] of [
        [a, b],
        [b, c],
        [c, a],
      ] as const) {
        const key = edgeKey(p, q);
        const bucket = edgeMap.get(key);
        if (bucket === undefined) {
          edgeMap.set(key, [t]);
        } else {
          bucket.push(t);
        }
      }
    }
    for (const tris of edgeMap.values()) {
      if (tris.length < 2) {
        continue;
      }
      for (const t of tris) {
        for (const other of tris) {
          if (other !== t && !this.#triangles[t].neighbors.includes(other)) {
            this.#triangles[t].neighbors.push(other);
          }
        }
      }
    }
  }

  get triangleCount(): number {
    return this.#triangles.length;
  }

  /** 最近可走点：先查网格邻域三角形，取三维最近点。 */
  nearestPoint(p: Vec3): NavPoint | null {
    if (this.#triangles.length === 0) {
      return null;
    }
    const cx = Math.floor((p.x - this.#cellMinX) / CELL_SIZE);
    const cz = Math.floor((p.z - this.#cellMinZ) / CELL_SIZE);
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
          const bucket = this.#cells.get((cz + dz) * this.#cellCols + (cx + dx));
          if (bucket === undefined) {
            continue;
          }
          for (const t of bucket) {
            const { a, b, c } = this.#triangles[t];
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
    const heuristic = (tri: number): number => distanceOf(this.#triangles[tri].centroid, goalPoint);
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
      const currentTri = this.#triangles[current];
      const currentG = gScore.get(current) ?? Infinity;
      for (const next of currentTri.neighbors) {
        if (closed.has(next)) {
          continue;
        }
        // 代价 = 穿过共享边（portal）中点的路程：当前三角形中心 → 边中点 → 下一三角形中心
        const portal = this.#portalMid(current, next);
        const stepCost =
          distanceOf(currentTri.centroid, portal) + distanceOf(portal, this.#triangles[next].centroid);
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
    const ta = this.#triangles[a];
    const tb = this.#triangles[b];
    const av = [ta.ia, ta.ib, ta.ic];
    const bv = [tb.ia, tb.ib, tb.ic];
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
    return midOf(ta.centroid, tb.centroid);
  }

  #vertexAt(index: number): Vec3 {
    return {
      x: this.#vertices[index * 3],
      y: this.#vertices[index * 3 + 1],
      z: this.#vertices[index * 3 + 2],
    };
  }
}

/** 解析导航网格数据文档；格式不符或数据为空返回 null。 */
export function navMeshFromDoc(doc: NavmeshDoc): NavMesh | null {
  if (doc.format !== NAVMESH_FORMAT) {
    throw new RangeError(`导航数据 format 应为 ${NAVMESH_FORMAT}`);
  }
  const vertexBytes = decodeBase64Bytes(doc.vertexData);
  const polygonBytes = decodeBase64Bytes(doc.polygonData);
  if (vertexBytes.length === 0 || polygonBytes.length === 0) {
    return null;
  }
  const vertices = new Float32Array(vertexBytes.buffer, vertexBytes.byteOffset, vertexBytes.byteLength / 4);
  const indices = new Uint32Array(polygonBytes.buffer, polygonBytes.byteOffset, polygonBytes.byteLength / 4);
  for (let i = 0; i < indices.length; i += 1) {
    if (indices[i] >= vertices.length / 3) {
      throw new RangeError(`导航数据顶点索引越界: ${indices[i]}`);
    }
  }
  return new NavMesh(vertices, indices);
}

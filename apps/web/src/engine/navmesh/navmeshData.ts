/**
 * 导航网格构建的纯计算层（Worker 安全：无 DOM/three 依赖，仅 TypedArray）。
 *
 * buildNavmeshData 完成「三角形化 + 均匀网格点定位 + 共享边邻接」三步重计算，
 * 产物全部为可转移 TypedArray（transferable），主线程与 Worker 之间零拷贝传输；
 * NavMesh（navmesh.ts）消费该结构做最近点/A* 查询。
 *
 * 邻接判定沿用原实现：量化坐标（1/1000 米）字符串键匹配共享边——
 * 跨 tile 重复顶点天然对齐；该口径与历史数据构建结果一致（结果一致性见测试）。
 */

const CELL_SIZE = 32; // 点定位均匀网格边长（米）
const EDGE_QUANT = 1000; // 共享边匹配的坐标量化精度（1/m）

/** 构建产物：可转移的导航网格结构（查询侧只读消费）。 */
export interface NavmeshData {
  readonly vertices: Float32Array;
  readonly triangleCount: number;
  /** 三角形顶点索引（3n）。 */
  readonly triVerts: Uint32Array;
  /** 三角形质心（3n）。 */
  readonly centroids: Float32Array;
  /** 邻接表前缀（n+1）+ 扁平邻居列表。 */
  readonly neighborsOffset: Uint32Array;
  readonly neighbors: Uint32Array;
  /** 点定位均匀网格：键（升序）+ 桶前缀 + 扁平三角形列表。 */
  readonly cellKeys: Int32Array;
  readonly cellBucketOffset: Uint32Array;
  readonly cellBuckets: Uint32Array;
  readonly cellCols: number;
  readonly cellMinX: number;
  readonly cellMinZ: number;
}

function edgeKey(px: number, py: number, pz: number, qx: number, qy: number, qz: number): string {
  const ax = Math.round(px * EDGE_QUANT);
  const ay = Math.round(py * EDGE_QUANT);
  const az = Math.round(pz * EDGE_QUANT);
  const bx = Math.round(qx * EDGE_QUANT);
  const by = Math.round(qy * EDGE_QUANT);
  const bz = Math.round(qz * EDGE_QUANT);
  // 按坐标字典序归一化方向，保证 (a,b) 与 (b,a) 同键
  const forward = ax < bx || (ax === bx && (ay < by || (ay === by && az <= bz)));
  const [sx, sy, sz, tx, ty, tz] = forward ? [px, py, pz, qx, qy, qz] : [qx, qy, qz, px, py, pz];
  return `${sx.toFixed(3)},${sy.toFixed(3)},${sz.toFixed(3)}|${tx.toFixed(3)},${ty.toFixed(3)},${tz.toFixed(3)}`;
}

/**
 * 构建：顶点 float32(x,y,z) + 三角形索引 uint32 → NavmeshData。
 * 空数据（无三角形）返回 triangleCount = 0 的空结构。
 */
export function buildNavmeshData(vertices: Float32Array, indices: Uint32Array): NavmeshData {
  const triangleCount = Math.floor(indices.length / 3);
  const triVerts = new Uint32Array(triangleCount * 3);
  const centroids = new Float32Array(triangleCount * 3);
  for (let t = 0; t < triangleCount; t += 1) {
    const ia = indices[t * 3];
    const ib = indices[t * 3 + 1];
    const ic = indices[t * 3 + 2];
    triVerts[t * 3] = ia;
    triVerts[t * 3 + 1] = ib;
    triVerts[t * 3 + 2] = ic;
    const ax = vertices[ia * 3];
    const ay = vertices[ia * 3 + 1];
    const az = vertices[ia * 3 + 2];
    const bx = vertices[ib * 3];
    const by = vertices[ib * 3 + 1];
    const bz = vertices[ib * 3 + 2];
    const cx = vertices[ic * 3];
    const cy = vertices[ic * 3 + 1];
    const cz = vertices[ic * 3 + 2];
    centroids[t * 3] = (ax + bx + cx) / 3;
    centroids[t * 3 + 1] = (ay + by + cy) / 3;
    centroids[t * 3 + 2] = (az + bz + cz) / 3;
  }

  // 包围盒（XZ 平面）
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < triangleCount; i += 1) {
    for (let k = 0; k < 3; k += 1) {
      const x = vertices[triVerts[i * 3 + k] * 3];
      const z = vertices[triVerts[i * 3 + k] * 3 + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  if (triangleCount === 0) {
    return {
      vertices,
      triangleCount: 0,
      triVerts,
      centroids,
      neighborsOffset: new Uint32Array(1),
      neighbors: new Uint32Array(0),
      cellKeys: new Int32Array(0),
      cellBucketOffset: new Uint32Array(1),
      cellBuckets: new Uint32Array(0),
      cellCols: 1,
      cellMinX: 0,
      cellMinZ: 0,
    };
  }
  const cellMinX = minX - 1;
  const cellMinZ = minZ - 1;
  const cellCols = Math.max(1, Math.ceil((maxX - minX + 2) / CELL_SIZE));

  // 均匀网格桶（Map → 排序键数组）
  const cellMap = new Map<number, number[]>();
  const cellKeyOf = (cx: number, cz: number): number => cz * cellCols + cx;
  for (let t = 0; t < triangleCount; t += 1) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let k = 0; k < 3; k += 1) {
      const x = vertices[triVerts[t * 3 + k] * 3];
      const z = vertices[triVerts[t * 3 + k] * 3 + 2];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    const cx0 = Math.floor((x0 - cellMinX) / CELL_SIZE);
    const cx1 = Math.floor((x1 - cellMinX) / CELL_SIZE);
    const cz0 = Math.floor((z0 - cellMinZ) / CELL_SIZE);
    const cz1 = Math.floor((z1 - cellMinZ) / CELL_SIZE);
    for (let cz = cz0; cz <= cz1; cz += 1) {
      for (let cx = cx0; cx <= cx1; cx += 1) {
        const key = cellKeyOf(cx, cz);
        const bucket = cellMap.get(key);
        if (bucket === undefined) {
          cellMap.set(key, [t]);
        } else {
          bucket.push(t);
        }
      }
    }
  }
  const cellKeys = Int32Array.from([...cellMap.keys()].toSorted((a, b) => a - b));
  const cellBucketOffset = new Uint32Array(cellKeys.length + 1);
  let bucketTotal = 0;
  for (let i = 0; i < cellKeys.length; i += 1) {
    bucketTotal += cellMap.get(cellKeys[i])?.length ?? 0;
    cellBucketOffset[i + 1] = bucketTotal;
  }
  const cellBuckets = new Uint32Array(bucketTotal);
  for (let i = 0; i < cellKeys.length; i += 1) {
    const bucket = cellMap.get(cellKeys[i]) ?? [];
    for (let j = 0; j < bucket.length; j += 1) {
      cellBuckets[cellBucketOffset[i] + j] = bucket[j];
    }
  }

  // 共享边 → 邻接（量化坐标匹配；跨 tile 重复顶点天然对齐）
  const edgeMap = new Map<string, number[]>();
  for (let t = 0; t < triangleCount; t += 1) {
    for (let e = 0; e < 3; e += 1) {
      const pa = triVerts[t * 3 + e] * 3;
      const pb = triVerts[t * 3 + ((e + 1) % 3)] * 3;
      const key = edgeKey(
        vertices[pa],
        vertices[pa + 1],
        vertices[pa + 2],
        vertices[pb],
        vertices[pb + 1],
        vertices[pb + 2],
      );
      const bucket = edgeMap.get(key);
      if (bucket === undefined) {
        edgeMap.set(key, [t]);
      } else {
        bucket.push(t);
      }
    }
  }
  const neighborLists: number[][] = Array.from({ length: triangleCount }, () => []);
  for (const tris of edgeMap.values()) {
    if (tris.length < 2) {
      continue;
    }
    for (const t of tris) {
      for (const other of tris) {
        if (other !== t && !neighborLists[t].includes(other)) {
          neighborLists[t].push(other);
        }
      }
    }
  }
  const neighborsOffset = new Uint32Array(triangleCount + 1);
  let neighborTotal = 0;
  for (let t = 0; t < triangleCount; t += 1) {
    neighborTotal += neighborLists[t].length;
    neighborsOffset[t + 1] = neighborTotal;
  }
  const neighbors = new Uint32Array(neighborTotal);
  for (let t = 0; t < triangleCount; t += 1) {
    const list = neighborLists[t];
    for (let j = 0; j < list.length; j += 1) {
      neighbors[neighborsOffset[t] + j] = list[j];
    }
  }

  return {
    vertices,
    triangleCount,
    triVerts,
    centroids,
    neighborsOffset,
    neighbors,
    cellKeys,
    cellBucketOffset,
    cellBuckets,
    cellCols,
    cellMinX,
    cellMinZ,
  };
}

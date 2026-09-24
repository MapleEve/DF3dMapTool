import { describe, expect, it } from "vitest";
import { NAVMESH_FORMAT, NavMesh, navMeshFromDoc, type NavmeshDoc } from "./navmesh";

/** 类型化数组 → base64（顶点/索引流编码）。 */
function toBase64(view: Float32Array | Uint32Array): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** 构造 base64 文档（顶点 float32 xyz + 三角形 uint32 索引流）。 */
function buildDoc(
  vertices: number[],
  triangles: number[],
  overrides: Partial<NavmeshDoc> = {},
): NavmeshDoc {
  const vertexBytes = new Float32Array(vertices);
  const polygonBytes = new Uint32Array(triangles);
  return {
    format: NAVMESH_FORMAT,
    mapCode: "test",
    agentRadius: 0.25,
    bounds: { min: [0, 0, 0], max: [20, 0, 20] },
    vertexCount: vertices.length / 3,
    polygonCount: triangles.length / 3,
    vertexData: toBase64(vertexBytes),
    polygonData: toBase64(polygonBytes),
    ...overrides,
  };
}

/** 3×3 网格第 (i, j) 格的四个顶点序号（行主序）。 */
function cell(i: number, j: number): [number, number, number, number] {
  const v00 = j * 3 + i;
  const v10 = j * 3 + i + 1;
  const v01 = (j + 1) * 3 + i;
  const v11 = (j + 1) * 3 + i + 1;
  return [v00, v10, v11, v01];
}

/** 2×2 单元网格（每格 10m，两三角形），外加一块孤立三角形。 */
function gridWithIsland(): NavmeshDoc {
  // 顶点 0..8：3×3 网格 (x, 0, z)
  const vertices: number[] = [];
  for (let j = 0; j < 3; j += 1) {
    for (let i = 0; i < 3; i += 1) {
      vertices.push(i * 10, 0, j * 10);
    }
  }
  const triangles: number[] = [];
  for (const [a, b, c, d] of [cell(0, 0), cell(1, 0), cell(0, 1), cell(1, 1)]) {
    triangles.push(a, b, c, a, c, d);
  }
  // 孤立三角形（不与网格共享任何边）
  const island = vertices.length / 3;
  vertices.push(100, 0, 100, 110, 0, 100, 100, 0, 110);
  triangles.push(island, island + 1, island + 2);
  return buildDoc(vertices, triangles);
}

describe("NavMesh 寻路", () => {
  it("文档格式不符时抛出 RangeError", () => {
    const doc = gridWithIsland();
    expect(() => navMeshFromDoc({ ...doc, format: "other/1" })).toThrow(RangeError);
  });

  it("顶点索引越界时抛出 RangeError", () => {
    const bad = buildDoc([0, 0, 0, 1, 0, 0, 0, 0, 1], [0, 1, 99]);
    expect(() => navMeshFromDoc(bad)).toThrow(RangeError);
  });

  it("空数据文档返回 null", () => {
    const doc = buildDoc([], []);
    expect(navMeshFromDoc(doc)).toBeNull();
  });

  it("平面上两点寻路：路径近似直线，长度不显著偏离欧氏距离", () => {
    const mesh = navMeshFromDoc(gridWithIsland());
    expect(mesh).not.toBeNull();
    const path = mesh!.findPath({ x: 1, y: 0, z: 1 }, { x: 19, y: 0, z: 19 });
    expect(path).not.toBeNull();
    const straight = Math.hypot(18, 18);
    expect(path!.distance).toBeGreaterThan(straight * 0.98);
    expect(path!.distance).toBeLessThan(straight * 1.25);
    // 首末途经点应为吸附后的起终点
    expect(path!.points[0]).toEqual({ x: 1, y: 0, z: 1 });
    expect(path!.points[path!.points.length - 1]).toEqual({ x: 19, y: 0, z: 19 });
  });

  it("不连通区域寻路返回 null（无解）", () => {
    const mesh = navMeshFromDoc(gridWithIsland());
    expect(mesh).not.toBeNull();
    const path = mesh!.findPath({ x: 1, y: 0, z: 1 }, { x: 102, y: 0, z: 101 });
    expect(path).toBeNull();
  });

  it("最近点吸附：网格外查询点落到最近可走位置", () => {
    const mesh = navMeshFromDoc(gridWithIsland());
    expect(mesh).not.toBeNull();
    const point = mesh!.nearestPoint({ x: 5, y: 3, z: -4 });
    expect(point).not.toBeNull();
    expect(point!.point.x).toBeCloseTo(5, 5);
    expect(point!.point.z).toBeCloseTo(0, 5);
    expect(point!.point.y).toBeCloseTo(0, 5);
  });

  it("三角形邻接可横穿网格（9 个三角形）", () => {
    const mesh = navMeshFromDoc(gridWithIsland());
    expect(mesh).not.toBeNull();
    expect(mesh!.triangleCount).toBe(9);
    const path = mesh!.findPath({ x: 1, y: 0, z: 10 }, { x: 19, y: 0, z: 10 });
    expect(path).not.toBeNull();
  });
});

describe("NavMesh 原始构造（uint32 索引）", () => {
  it("直接以 Float32Array/Uint32Array 构造并寻路", () => {
    const vertices = new Float32Array([0, 0, 0, 10, 0, 0, 10, 0, 10, 0, 0, 10]);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    const mesh = new NavMesh(vertices, indices);
    const path = mesh.findPath({ x: 1, y: 0, z: 1 }, { x: 9, y: 0, z: 9 });
    expect(path).not.toBeNull();
    expect(path!.points.length).toBe(2);
    expect(path!.distance).toBeCloseTo(Math.hypot(8, 8), 6);
  });
});

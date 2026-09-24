import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DmapError, DmapMapPackage, DmapWriter } from "@df3dmaptool/dmap";
import { DMAP_KEY_MATERIAL } from "./dmapKey";
import { readSceneDoc } from "./mapBundle";
import { containerFetcher } from "./assets";
import { ChunkGltfParser, disposeObject3D, splitInstancedMeshByFloor } from "./gltf";
import { InstancedMesh, Object3D } from "three";

const REAL_INDEX_URL = new URL("../../public/assets/az3/index.dmap", import.meta.url);

/** 测试用 fetch 桩：URL → 字节，并记录调用。 */
type FetchLog = { url: string }[];
function stubFetch(routes: Map<string, Uint8Array>, log?: FetchLog): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    log?.push({ url });
    const bytes = routes.get(url);
    if (bytes === undefined) {
      throw new Error(`fetch 桩未配置: ${url}`);
    }
    const body = bytes.slice().buffer;
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => body,
    } as unknown as Response;
  }) as typeof fetch;
}

async function sealContainer(entries: Record<string, unknown>): Promise<Uint8Array> {
  const writer = DmapWriter.create();
  for (const [name, value] of Object.entries(entries)) {
    if (typeof value === "string") {
      writer.addText(name, value, "application/json");
    } else {
      writer.add(name, "application/json", value as Uint8Array);
    }
  }
  return writer.write(DMAP_KEY_MATERIAL);
}

const SYNTHETIC_MANIFEST = {
  format: "dmap-map-manifest/3",
  map: { mapId: 901, code: "testmap" },
  floors: [1, 2],
  counts: { chunks: 2, instances: 4, vertices: 6, triangles: 2, geometries: 2, pois: 1 },
  entries: {
    scene: "maps/testmap/scene.json",
    poi: "maps/testmap/poi.json",
    map2d: "maps/testmap/map2d.json",
    configs: [],
    icons: "icons/index.json",
    minimaps: "minimap/index.json",
  },
  chunks: [
    {
      id: "0_0",
      file: "chunks/c_0_0.dmap",
      instances: 3,
      vertices: 3,
      triangles: 1,
      geometries: 1,
      bytes: 8,
      bytesCompressed: 8,
      containerBytes: 238,
      boundsMin: [0, 0, 0],
      boundsMax: [20, 20, 1],
    },
    {
      id: "1_0",
      file: "chunks/c_1_0.dmap",
      instances: 1,
      vertices: 3,
      triangles: 1,
      geometries: 1,
      bytes: 4,
      bytesCompressed: 4,
      containerBytes: 234,
      boundsMin: [100, 0, 0],
      boundsMax: [101, 1, 1],
    },
  ],
};

describe("DmapMapPackage 分片往返（合成包）", () => {
  it("openIndex → 清单校验 → 场景 JSON → 惰性读分块字节", async () => {
    const glb0 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const glb1 = new Uint8Array([9, 9, 9, 9]);
    const sceneDoc = {
      mapCode: "testmap",
      mapId: 901,
      floorValues: [1, 2],
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      floorTriggers: [],
    };
    const index = await sealContainer({
      "manifest.json": JSON.stringify(SYNTHETIC_MANIFEST),
      "maps/testmap/scene.json": JSON.stringify(sceneDoc),
    });
    const chunk0 = await sealContainer({ "chunk.glb": glb0 });
    const chunk1 = await sealContainer({ "chunk.glb": glb1 });
    const log: FetchLog = [];
    stubFetch(
      new Map([
        ["http://test.local/data/testmap/index.dmap", index],
        ["http://test.local/data/testmap/chunks/c_0_0.dmap", chunk0],
        ["http://test.local/data/testmap/chunks/c_1_0.dmap", chunk1],
      ]),
      log,
    );

    // 两段式：第一段只碰索引容器。
    const pkg = await DmapMapPackage.openIndex(index, DMAP_KEY_MATERIAL, {
      fetchContainer: containerFetcher("http://test.local/data/testmap/index.dmap"),
    });
    expect(pkg.mapId).toBe(901);
    expect(pkg.mapCode).toBe("testmap");
    expect(pkg.floors).toEqual([1, 2]);
    expect(pkg.manifest.chunks).toHaveLength(2);
    expect(readSceneDoc(pkg)).toEqual(sceneDoc);

    // 第二段：分块容器按名惰性拉取，载荷逐字节一致。
    const chunkBytes = await pkg.readChunk(pkg.manifest.chunks[1]!);
    expect([...chunkBytes]).toEqual([...glb1]);
    expect(log.map((entry) => entry.url)).toEqual([
      "http://test.local/data/testmap/chunks/c_1_0.dmap",
    ]);
    // 容器缓存：再次读取不再触发 fetch。
    await pkg.readChunk(pkg.manifest.chunks[1]!);
    expect(log.length).toBe(1);
    pkg.dispose();
  });

  it("清单格式不符抛 bad_manifest（DmapError 体系）", async () => {
    const bytes = await sealContainer({
      "manifest.json": JSON.stringify({ format: "unknown/9", maps: [] }),
    });
    await expect(DmapMapPackage.openIndex(bytes, DMAP_KEY_MATERIAL)).rejects.toMatchObject({
      name: "DmapFormatError",
      code: "bad_manifest",
    });
  });

  it("索引容器被篡改时 DmapError 上抛（完整性校验）", async () => {
    const bytes = await sealContainer({
      "manifest.json": JSON.stringify(SYNTHETIC_MANIFEST),
    });
    const tampered = bytes.slice();
    tampered[tampered.length - 40] ^= 0xff;
    stubFetch(new Map([["http://test.local/tampered/index.dmap", tampered]]));
    await expect(
      DmapMapPackage.openIndex(tampered, DMAP_KEY_MATERIAL, {
        fetchContainer: containerFetcher("http://test.local/tampered/index.dmap"),
      }),
    ).rejects.toBeInstanceOf(DmapError);
  });

  it("场景元数据 mapId 与清单不一致 → RangeError", async () => {
    const index = await sealContainer({
      "manifest.json": JSON.stringify(SYNTHETIC_MANIFEST),
      "maps/testmap/scene.json": JSON.stringify({
        mapCode: "testmap",
        mapId: 999,
        floorValues: [1, 2],
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
        floorTriggers: [],
      }),
    });
    const pkg = await DmapMapPackage.openIndex(index, DMAP_KEY_MATERIAL);
    expect(() => readSceneDoc(pkg)).toThrow(RangeError);
  });
});

/** 构造最小 GLB：1 个三角形 + EXT_mesh_gpu_instancing（3 实例，Y=0/5/20）。 */
function buildInstancedGlb(): Uint8Array {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const indices = new Uint32Array([0, 1, 2]);
  const translations = new Float32Array([0, 0, 0, 10, 5, 0, 20, 20, 0]);
  const rotations = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const scales = new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]);

  const binChunks: { data: Uint8Array; target: number }[] = [
    { data: new Uint8Array(positions.buffer), target: 34962 },
    { data: new Uint8Array(normals.buffer), target: 34962 },
    { data: new Uint8Array(indices.buffer), target: 34963 },
    { data: new Uint8Array(translations.buffer), target: 34962 },
    { data: new Uint8Array(rotations.buffer), target: 34962 },
    { data: new Uint8Array(scales.buffer), target: 34962 },
  ];
  const bin = new Uint8Array(
    binChunks.reduce((sum, chunk) => sum + ((chunk.data.length + 3) & ~3), 0),
  );
  const views: Record<string, number>[] = [];
  let offset = 0;
  for (const chunk of binChunks) {
    bin.set(chunk.data, offset);
    views.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: chunk.data.length,
      target: chunk.target,
    });
    offset += (chunk.data.length + 3) & ~3;
  }

  const gltf = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      {
        name: "inst-0",
        mesh: 0,
        extensions: {
          EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 3, ROTATION: 4, SCALE: 5 } },
        },
        extras: { resPath: "Scene/AZ3/test.prefab", tag: 16 },
      },
    ],
    meshes: [
      {
        name: "m0",
        primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0, mode: 4 }],
      },
    ],
    materials: [{ name: "default", pbrMetallicRoughness: { baseColorFactor: [0.7, 0.7, 0.7, 1] } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: views,
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 2, componentType: 5125, count: 3, type: "SCALAR" },
      { bufferView: 3, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 4, componentType: 5126, count: 3, type: "VEC4" },
      { bufferView: 5, componentType: 5126, count: 3, type: "VEC3" },
    ],
    extensionsUsed: ["EXT_mesh_gpu_instancing"],
  };

  let jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
  if (jsonPadding > 0) {
    const padded = new Uint8Array(jsonBytes.length + jsonPadding);
    padded.set(jsonBytes);
    padded.fill(0x20, jsonBytes.length);
    jsonBytes = padded;
  }
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const binHeader = 20 + jsonBytes.length;
  view.setUint32(binHeader, bin.length, true);
  view.setUint32(binHeader + 4, 0x004e4942, true);
  out.set(bin, binHeader + 8);
  return out;
}

function instanceYs(mesh: InstancedMesh): number[] {
  const array = mesh.instanceMatrix.array as ArrayLike<number>;
  return Array.from({ length: mesh.count }, (_, index) => array[index * 16 + 13]);
}

describe("GLB → three（实例化扩展 + 楼层拆分）", () => {
  it("GLTFLoader 解析 EXT_mesh_gpu_instancing 为 InstancedMesh", async () => {
    const parser = new ChunkGltfParser();
    try {
      const scene = await parser.parseGlb(buildInstancedGlb());
      expect(scene).toBeInstanceOf(Object3D);
      expect(scene.children).toHaveLength(1);
      const mesh = scene.children[0];
      expect(mesh).toBeInstanceOf(InstancedMesh);
      const instanced = mesh as InstancedMesh;
      expect(instanced.count).toBe(3);
      expect(instanced.userData.resPath).toBe("Scene/AZ3/test.prefab");
      expect(instanceYs(instanced).map((y) => Math.round(y))).toEqual([0, 5, 20]);
      disposeObject3D(scene);
    } finally {
      parser.dispose();
    }
  });

  it("splitInstancedMeshByFloor：同层免拷贝、跨层拆分并保留矩阵", async () => {
    const parser = new ChunkGltfParser();
    try {
      const scene = await parser.parseGlb(buildInstancedGlb());
      const mesh = scene.children[0] as InstancedMesh;

      // 单一分带：原样返回，不克隆
      const single = splitInstancedMeshByFloor(mesh, [
        { floor: 1, yMin: Number.NEGATIVE_INFINITY, yMax: Number.POSITIVE_INFINITY },
      ]);
      expect(single).toHaveLength(1);
      expect(single[0].floor).toBe(1);
      expect(single[0].mesh).toBe(mesh);

      // 上下两层：floor1 取 Y<10（2 实例），floor2 取其余（1 实例）
      const bands = [
        { floor: 1, yMin: Number.NEGATIVE_INFINITY, yMax: 10 },
        { floor: 2, yMin: 10, yMax: Number.POSITIVE_INFINITY },
      ];
      const parts = splitInstancedMeshByFloor(mesh, bands);
      expect(parts).toHaveLength(2);
      const floor1 = parts.find((part) => part.floor === 1);
      const floor2 = parts.find((part) => part.floor === 2);
      expect(floor1?.mesh.count).toBe(2);
      expect(floor2?.mesh.count).toBe(1);
      expect(instanceYs(floor1!.mesh).map((y) => Math.round(y))).toEqual([0, 5]);
      expect(instanceYs(floor2!.mesh).map((y) => Math.round(y))).toEqual([20]);
      expect(floor1!.mesh.userData.resPath).toBe("Scene/AZ3/test.prefab");
      disposeObject3D(scene);
      disposeObject3D(floor1!.mesh);
      disposeObject3D(floor2!.mesh);
    } finally {
      parser.dispose();
    }
  });
});

describe("真实分片数据包（az3/index.dmap，本仓内置资产）", () => {
  const skipped = !existsSync(REAL_INDEX_URL);

  // it.skipIf 为 vitest 与 bun:test 共有的条件运行 API。
  it.skipIf(skipped)(
    "索引读回/场景元数据/分块容器端到端校验",
    async () => {
      const indexBytes = new Uint8Array(readFileSync(REAL_INDEX_URL));
      const pkg = await DmapMapPackage.openIndex(indexBytes, DMAP_KEY_MATERIAL, {
        fetchContainer: async (file) => {
          const url = new URL(`../../public/assets/az3/${file}`, import.meta.url);
          return new Uint8Array(readFileSync(url));
        },
      });
      expect(pkg.mapId).toBe(106);
      expect(pkg.mapCode).toBe("az3");
      expect(pkg.floors).toEqual([1, 2, 3]);
      expect(pkg.manifest.format).toBe("dmap-map-manifest/3");
      expect(pkg.manifest.counts.chunks).toBe(96);
      expect(pkg.manifest.counts.instances).toBe(45595);

      const chunks = pkg.manifest.chunks;
      expect(chunks.length).toBeGreaterThan(50);
      // 分块文件名约定：c_<x>_<y>.dmap。
      expect(chunks[0]?.file).toMatch(/^chunks\/c_-?\d+_-?\d+\.dmap$/);

      const sceneDoc = readSceneDoc(pkg);
      expect(sceneDoc.floorValues).toEqual([1, 2, 3]);
      expect(sceneDoc.floorTriggers.length).toBeGreaterThan(3);
      expect(sceneDoc.bounds.min[0]).toBeLessThan(sceneDoc.bounds.max[0]);

      // 分块 GLB 字节：长度与清单一致、GLB magic 正确。
      const first = chunks[0]!;
      const glb = await pkg.readChunk(first);
      expect(glb.byteLength).toBe(first.bytesCompressed);
      expect(String.fromCharCode(glb[0], glb[1], glb[2], glb[3])).toBe("glTF");
      pkg.dispose();
    },
    30000,
  );
});

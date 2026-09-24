import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DmapError, DmapWriter } from '@df3dmaptool/dmap';
import { DMAP_KEY_MATERIAL } from './dmapKey';
import { DmapMapBundle, MapBundleFormatError, readSceneDoc } from './mapBundle';
import { ChunkGltfParser, splitInstancedMeshByFloor } from './gltf';
import { disposeObject3D } from './gltf';
import { InstancedMesh, Object3D } from 'three';

const REAL_BUNDLE_URL = new URL('../../public/assets/az3.dmap', import.meta.url);

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
    if (typeof value === 'string') {
      writer.addText(name, value, 'application/json');
    } else {
      writer.add(name, 'application/json', value as Uint8Array);
    }
  }
  return writer.write(DMAP_KEY_MATERIAL);
}

const SYNTHETIC_MANIFEST = {
  format: 'dmap-map-manifest/1',
  map: { mapId: 901, code: 'testmap' },
  floors: [1, 2],
  containers: ['testmap.dmap'],
  entries: {
    scene: 'maps/testmap/scene.json',
    poi: 'maps/testmap/poi.json',
    map2d: 'maps/testmap/map2d.json',
    configs: [],
    icons: 'icons/index.json',
    minimaps: 'minimap/index.json',
  },
  counts: { chunks: 1, instances: 3, vertices: 3, triangles: 1, geometries: 1 },
  chunkBounds: [
    {
      id: '0_0',
      file: 'chunks/b0_0.glb',
      container: 0,
      instances: 3,
      vertices: 3,
      triangles: 1,
      geometries: 1,
      bytes: 0,
      boundsMin: [0, 0, 0],
      boundsMax: [20, 20, 1],
    },
  ],
};

describe('DmapMapBundle 往返（合成包）', () => {
  it('open → 清单校验 → 读 chunk 字节与场景 JSON', async () => {
    const glb = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const sceneDoc = { mapCode: 'testmap', mapId: 901, floorValues: [1, 2], bounds: { min: [0, 0, 0], max: [1, 1, 1] }, floorTriggers: [] };
    const bytes = await sealContainer({
      'manifest.json': JSON.stringify(SYNTHETIC_MANIFEST),
      'maps/testmap/scene.json': JSON.stringify(sceneDoc),
      'maps/testmap/chunks/b0_0.glb': glb,
    });
    stubFetch(new Map([['http://test.local/data/testmap.dmap', bytes]]));

    const bundle = await DmapMapBundle.open('http://test.local/data/testmap.dmap');
    expect(bundle.mapId).toBe(901);
    expect(bundle.mapCode).toBe('testmap');
    expect(bundle.floors).toEqual([1, 2]);
    expect(bundle.manifest.chunkBounds).toHaveLength(1);

    await expect(readSceneDoc(bundle)).resolves.toEqual(sceneDoc);
    const chunkBytes = await bundle.readChunkBytes(bundle.manifest.chunkBounds[0]);
    expect([...chunkBytes]).toEqual([...glb]);
    bundle.dispose();
  });

  it('清单格式不符抛 MapBundleFormatError', async () => {
    const bytes = await sealContainer({
      'manifest.json': JSON.stringify({ format: 'unknown/9', map: {} }),
    });
    stubFetch(new Map([['http://test.local/bad.dmap', bytes]]));
    await expect(DmapMapBundle.open('http://test.local/bad.dmap')).rejects.toBeInstanceOf(
      MapBundleFormatError,
    );
  });

  it('多容器：chunk 所在容器按需懒加载', async () => {
    const manifest = {
      ...SYNTHETIC_MANIFEST,
      containers: ['testmap.dmap', 'testmap_2.dmap'],
      chunkBounds: [
        { ...SYNTHETIC_MANIFEST.chunkBounds[0] },
        {
          id: '1_0',
          file: 'chunks/b1_0.glb',
          container: 1,
          instances: 1,
          vertices: 3,
          triangles: 1,
          geometries: 1,
          bytes: 4,
          boundsMin: [100, 0, 0],
          boundsMax: [101, 1, 1],
        },
      ],
    };
    const primary = await sealContainer({
      'manifest.json': JSON.stringify(manifest),
    });
    const second = await sealContainer({
      'maps/testmap/chunks/b1_0.glb': new Uint8Array([9, 9, 9, 9]),
    });
    const log: FetchLog = [];
    stubFetch(
      new Map([
        ['http://test.local/data/testmap.dmap', primary],
        ['http://test.local/data/testmap_2.dmap', second],
      ]),
      log,
    );

    const bundle = await DmapMapBundle.open('http://test.local/data/testmap.dmap');
    const bytes = await bundle.readChunkBytes(manifest.chunkBounds[1]);
    expect([...bytes]).toEqual([9, 9, 9, 9]);
    expect(log.map((entry) => entry.url)).toEqual([
      'http://test.local/data/testmap.dmap',
      'http://test.local/data/testmap_2.dmap',
    ]);
    // 容器缓存：再次读取不再触发 fetch
    const before = log.length;
    await bundle.readChunkBytes(manifest.chunkBounds[1]);
    expect(log.length).toBe(before);
    bundle.dispose();
  });

  it('载荷被篡改时 DmapError 上抛（完整性校验）', async () => {
    const bytes = await sealContainer({
      'manifest.json': JSON.stringify(SYNTHETIC_MANIFEST),
    });
    const tampered = bytes.slice();
    tampered[tampered.length - 40] ^= 0xff;
    stubFetch(new Map([['http://test.local/tampered.dmap', tampered]]));
    await expect(DmapMapBundle.open('http://test.local/tampered.dmap')).rejects.toBeInstanceOf(
      DmapError,
    );
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
    binChunks.reduce((sum, chunk) => sum + (chunk.data.length + 3 & ~3), 0),
  );
  const views: Record<string, number>[] = [];
  let offset = 0;
  for (const chunk of binChunks) {
    bin.set(chunk.data, offset);
    views.push({ buffer: 0, byteOffset: offset, byteLength: chunk.data.length, target: chunk.target });
    offset += chunk.data.length + 3 & ~3;
  }

  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      {
        name: 'inst-0',
        mesh: 0,
        extensions: { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 3, ROTATION: 4, SCALE: 5 } } },
        extras: { resPath: 'Scene/AZ3/test.prefab', tag: 16 },
      },
    ],
    meshes: [
      { name: 'm0', primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0, mode: 4 }] },
    ],
    materials: [{ name: 'default', pbrMetallicRoughness: { baseColorFactor: [0.7, 0.7, 0.7, 1] } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5125, count: 3, type: 'SCALAR' },
      { bufferView: 3, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 4, componentType: 5126, count: 3, type: 'VEC4' },
      { bufferView: 5, componentType: 5126, count: 3, type: 'VEC3' },
    ],
    extensionsUsed: ['EXT_mesh_gpu_instancing'],
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

describe('GLB → three（实例化扩展 + 楼层拆分）', () => {
  it('GLTFLoader 解析 EXT_mesh_gpu_instancing 为 InstancedMesh', async () => {
    const parser = new ChunkGltfParser();
    try {
      const scene = await parser.parseGlb(buildInstancedGlb());
      expect(scene).toBeInstanceOf(Object3D);
      expect(scene.children).toHaveLength(1);
      const mesh = scene.children[0];
      expect(mesh).toBeInstanceOf(InstancedMesh);
      const instanced = mesh as InstancedMesh;
      expect(instanced.count).toBe(3);
      expect(instanced.userData.resPath).toBe('Scene/AZ3/test.prefab');
      expect(instanceYs(instanced).map((y) => Math.round(y))).toEqual([0, 5, 20]);
      disposeObject3D(scene);
    } finally {
      parser.dispose();
    }
  });

  it('splitInstancedMeshByFloor：同层免拷贝、跨层拆分并保留矩阵', async () => {
    const parser = new ChunkGltfParser();
    try {
      const scene = await parser.parseGlb(buildInstancedGlb());
      const mesh = scene.children[0] as InstancedMesh;

      // 单一分带：原样返回，不克隆
      const single = splitInstancedMeshByFloor(mesh, [{ floor: 1, yMin: Number.NEGATIVE_INFINITY, yMax: Number.POSITIVE_INFINITY }]);
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
      expect(floor1!.mesh.userData.resPath).toBe('Scene/AZ3/test.prefab');
      disposeObject3D(scene);
      disposeObject3D(floor1!.mesh);
      disposeObject3D(floor2!.mesh);
    } finally {
      parser.dispose();
    }
  });
});

describe('真实数据包（az3.dmap，本仓内置资产）', () => {
  const skipped = !existsSync(REAL_BUNDLE_URL);

  it.runIf(!skipped)('清单/场景元数据/chunk 字节端到端校验', async () => {
    const bytes = new Uint8Array(readFileSync(REAL_BUNDLE_URL));
    stubFetch(new Map([['http://test.local/data/az3.dmap', bytes]]));

    const bundle = await DmapMapBundle.open('http://test.local/data/az3.dmap');
    expect(bundle.mapId).toBe(106);
    expect(bundle.mapCode).toBe('az3');
    expect(bundle.floors).toEqual([1, 2, 3]);
    expect(bundle.manifest.containers).toEqual(['az3.dmap']);

    const chunks = bundle.manifest.chunkBounds;
    expect(chunks.length).toBeGreaterThan(50);
    expect(bundle.manifest.counts.instances).toBeGreaterThan(45000);

    const sceneDoc = await readSceneDoc(bundle);
    expect(sceneDoc.floorValues).toEqual([1, 2, 3]);
    expect(sceneDoc.floorTriggers.length).toBeGreaterThan(3);
    expect(sceneDoc.bounds.min[0]).toBeLessThan(sceneDoc.bounds.max[0]);

    // chunk GLB 字节：长度与清单一致、GLB magic 正确
    const first = chunks[0];
    const glb = await bundle.readChunkBytes(first);
    expect(glb.byteLength).toBe(first.bytesCompressed ?? first.bytes);
    expect(String.fromCharCode(glb[0], glb[1], glb[2], glb[3])).toBe('glTF');
    bundle.dispose();
  }, 30000);
});

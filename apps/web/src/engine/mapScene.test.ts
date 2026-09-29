import { describe, expect, it } from "vitest";
import { BufferGeometry, MeshBasicMaterial, Object3D, PerspectiveCamera, Texture } from "three";
import { DmapMapPackage, DmapWriter } from "@df3dmaptool/dmap";
import type { Vec3 } from "@/common/geometry";
import { DMAP_KEY_MATERIAL } from "./dmapKey";
import { disposeObject3D } from "./gltf";
import { FloorManager } from "./floorManager";
import { MapSceneLayer, type ChunkStreamStats } from "./mapScene";
import type { SceneDoc } from "./mapBundle";

/**
 * LOD 分层流式的引擎级生命周期测试：合成 v4 分片包（每 chunk 三层容器，
 * 层载荷带 lodTag 标记）驱动「低模先行 → 升级/降级 → 卸载」全链，
 * 断言挂载/释放配对与「当前应载集」进度口径。
 */

const KEY = DMAP_KEY_MATERIAL;

/** 构造最小实例化 GLB：1 三角形 + N 实例，节点 extras 携带 lodTag。 */
function buildInstancedGlb(tag: string, instanceCount: number): Uint8Array {
  const count = Math.max(1, instanceCount);
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const indices = new Uint32Array([0, 1, 2]);
  const translations = new Float32Array(count * 3);
  const rotations = new Float32Array(count * 4);
  const scales = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    translations.set([i * 2, 0, 0], i * 3);
    rotations.set([0, 0, 0, 1], i * 4);
    scales.set([1, 1, 1], i * 3);
  }
  const chunksDef: { data: Uint8Array; target: number }[] = [
    { data: new Uint8Array(positions.buffer), target: 34962 },
    { data: new Uint8Array(normals.buffer), target: 34962 },
    { data: new Uint8Array(indices.buffer), target: 34963 },
    { data: new Uint8Array(translations.buffer), target: 34962 },
    { data: new Uint8Array(rotations.buffer), target: 34962 },
    { data: new Uint8Array(scales.buffer), target: 34962 },
  ];
  const bin = new Uint8Array(
    chunksDef.reduce((sum, chunk) => sum + ((chunk.data.length + 3) & ~3), 0),
  );
  const views: Record<string, number>[] = [];
  let offset = 0;
  for (const chunk of chunksDef) {
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
        name: `inst-${tag}`,
        mesh: 0,
        extensions: {
          EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 3, ROTATION: 4, SCALE: 5 } },
        },
        extras: { lodTag: tag },
      },
    ],
    meshes: [
      { name: "m0", primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, mode: 4 }] },
    ],
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
      { bufferView: 3, componentType: 5126, count, type: "VEC3" },
      { bufferView: 4, componentType: 5126, count, type: "VEC4" },
      { bufferView: 5, componentType: 5126, count, type: "VEC3" },
    ],
    extensionsUsed: ["EXT_mesh_gpu_instancing"],
  };
  return sealGlb(gltf, bin);
}

/**
 * 空层 GLB（简化后无可渲染几何的层）：仅保留实例化节点，无 mesh 引用。
 * GLTFLoader 对无 mesh 的实例化节点产出普通 Object3D。
 */
function buildEmptyTierGlb(tag: string): Uint8Array {
  const translations = new Float32Array([0, 0, 0, 4, 0, 0]);
  const rotations = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]);
  const scales = new Float32Array([1, 1, 1, 1, 1, 1]);
  const chunksDef: { data: Uint8Array }[] = [
    { data: new Uint8Array(translations.buffer) },
    { data: new Uint8Array(rotations.buffer) },
    { data: new Uint8Array(scales.buffer) },
  ];
  const bin = new Uint8Array(
    chunksDef.reduce((sum, chunk) => sum + ((chunk.data.length + 3) & ~3), 0),
  );
  const views: Record<string, number>[] = [];
  let offset = 0;
  for (const chunk of chunksDef) {
    bin.set(chunk.data, offset);
    views.push({ buffer: 0, byteOffset: offset, byteLength: chunk.data.length });
    offset += (chunk.data.length + 3) & ~3;
  }
  return sealGlb(
    {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [
        {
          name: `empty-${tag}`,
          extensions: {
            EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 0, ROTATION: 1, SCALE: 2 } },
          },
          extras: { lodTag: tag },
        },
      ],
      buffers: [{ byteLength: bin.length }],
      bufferViews: views,
      accessors: [
        { bufferView: 0, componentType: 5126, count: 2, type: "VEC3" },
        { bufferView: 1, componentType: 5126, count: 2, type: "VEC4" },
        { bufferView: 2, componentType: 5126, count: 2, type: "VEC3" },
      ],
      extensionsUsed: ["EXT_mesh_gpu_instancing"],
    },
    bin,
  );
}

function sealGlb(json: unknown, bin: Uint8Array): Uint8Array {
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const padding = (4 - (jsonBytes.length % 4)) % 4;
  if (padding > 0) {
    const padded = new Uint8Array(jsonBytes.length + padding);
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

interface FixtureChunkSpec {
  readonly id: string;
  readonly boundsMin: [number, number, number];
  readonly boundsMax: [number, number, number];
  readonly instances: number;
  /** 各层载荷构造器；缺省 buildInstancedGlb(tag)。 */
  readonly emptyTiers?: readonly number[];
}

interface Fixture {
  readonly pkg: DmapMapPackage;
  readonly fetchLog: string[];
  readonly sceneDoc: SceneDoc;
  readonly floors: FloorManager;
}

/** 打一个 v4 合成分片包：每 chunk 三层容器（c_<id>_l{0,1,2}.dmap）。 */
async function buildTieredFixture(
  specs: readonly FixtureChunkSpec[],
  options: { singleTier?: boolean } = {},
): Promise<Fixture> {
  const containers = new Map<string, Uint8Array>();
  const manifestChunks: Record<string, unknown>[] = [];
  let instances = 0;
  for (const spec of specs) {
    instances += spec.instances;
    const base = {
      id: spec.id,
      instances: spec.instances,
      vertices: 3,
      triangles: 1,
      geometries: 1,
      bytes: 96,
      bytesCompressed: 96,
      containerBytes: 160,
      boundsMin: spec.boundsMin,
      boundsMax: spec.boundsMax,
    };
    if (options.singleTier) {
      // v3 单层：一个 chunk 一个容器，载荷标记 @l0。
      const tag = `${spec.id}@l0`;
      const payload = buildInstancedGlb(tag, spec.instances);
      containers.set(
        `chunks/c_${spec.id}.dmap`,
        await DmapWriter.create().add("chunk.glb", "model/gltf-binary", payload).write(KEY),
      );
      manifestChunks.push({ ...base, file: `chunks/c_${spec.id}.dmap` });
      continue;
    }
    const lods = [0, 1, 2].map((level) => {
      const tag = `${spec.id}@l${level}`;
      const empty = (spec.emptyTiers ?? []).includes(level);
      const payload = empty ? buildEmptyTierGlb(tag) : buildInstancedGlb(tag, spec.instances);
      return { level, payload, tag };
    });
    for (const lod of lods) {
      containers.set(
        `chunks/c_${spec.id}_l${lod.level}.dmap`,
        await DmapWriter.create().add("chunk.glb", "model/gltf-binary", lod.payload).write(KEY),
      );
    }
    manifestChunks.push({
      ...base,
      file: `chunks/c_${spec.id}_l0.dmap`,
      lods: lods.map((lod) => ({
        level: lod.level,
        file: `chunks/c_${spec.id}_l${lod.level}.dmap`,
        generated: lod.level > 0,
        instances: spec.instances,
        vertices: 3,
        triangles: 1,
        geometries: 1,
        bytes: 96,
        bytesCompressed: 96,
        containerBytes: 160,
        boundsMin: spec.boundsMin,
        boundsMax: spec.boundsMax,
      })),
    });
  }
  const manifest = {
    format: options.singleTier ? "dmap-map-manifest/3" : "dmap-map-manifest/4",
    map: { mapId: 901, code: "testmap" },
    floors: [1],
    counts: {
      chunks: specs.length,
      instances,
      vertices: 3 * specs.length,
      triangles: specs.length,
      geometries: specs.length,
      pois: 1,
    },
    entries: {
      scene: "maps/testmap/scene.json",
      poi: "maps/testmap/poi.json",
      map2d: "maps/testmap/map2d.json",
      configs: [],
      icons: "icons/index.json",
      minimaps: "minimap/index.json",
    },
    chunks: manifestChunks,
  };
  const indexBytes = await DmapWriter.create().addJson("manifest.json", manifest).write(KEY);
  const fetchLog: string[] = [];
  const pkg = await DmapMapPackage.openIndex(indexBytes, KEY, {
    fetchContainer: async (file: string) => {
      fetchLog.push(file);
      const bytes = containers.get(file);
      if (bytes === undefined) {
        throw new Error(`fetch 桩未配置: ${file}`);
      }
      return bytes;
    },
  });
  const sceneDoc: SceneDoc = {
    mapCode: "testmap",
    mapId: 901,
    floorValues: [1],
    bounds: { min: [-100, -50, -100], max: [3000, 100, 200] },
    floorTriggers: [],
  };
  return { pkg, fetchLog, sceneDoc, floors: new FloorManager() };
}

/** 俯视相机：覆盖两 chunk 的宽视场（fov 100，朝 -Y）。 */
function topDownCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(100, 1, 0.1, 6000);
  camera.position.set(510, 900, 20.001);
  camera.lookAt(510, 0, 20);
  return camera;
}

/** 等待流式排空（pending 归零）；超时抛错辅助定位。 */
async function settle(layer: MapSceneLayer, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (layer.stats.pendingChunks <= 0) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`流式未排空: ${JSON.stringify(layer.stats)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** 场景内当前挂载的全部 lodTag（楼层组遍历）。 */
function mountedTags(floors: FloorManager): string[] {
  const tags: string[] = [];
  floors.root.traverse((object: Object3D) => {
    const tag = (object.userData as { lodTag?: unknown }).lodTag;
    if (typeof tag === "string") {
      tags.push(tag);
    }
  });
  return tags;
}

function layerOptions() {
  return {
    renderDistance: 1500,
    streamingInterval: 0.2,
    lodThresholds: [300, 600] as const,
    lodHysteresis: 60,
  };
}

// 布局：A 近（中心 ~(20,0.5,20)），B 远（中心 ~(1020,0.5,20)）。
const SPECS: readonly FixtureChunkSpec[] = [
  { id: "0_0", boundsMin: [0, 0, 0], boundsMax: [40, 1, 40], instances: 4 },
  { id: "1_0", boundsMin: [1000, 0, 0], boundsMax: [1040, 1, 40], instances: 6 },
];

describe("MapSceneLayer · LOD 分层流式（v4 合成分片包）", () => {
  it("低模先行：近 chunk 直载 l0，远 chunk 只拉 l2；排空后进度 100%", async () => {
    const fixture = await buildTieredFixture(SPECS);
    const layer = new MapSceneLayer(fixture.pkg, fixture.sceneDoc, fixture.floors, layerOptions());
    let focus: Vec3 = { x: 0, y: 0, z: 0 };
    layer.attachCamera(topDownCamera());
    layer.setFocusProvider(() => focus);
    layer.update(0.3);
    await settle(layer);

    // 近 A（中心距 ~28m）→ l0；远 B（中心距 ~1020m）→ l2（低模先行）。
    expect(mountedTags(fixture.floors).toSorted()).toEqual(["0_0@l0", "1_0@l2"]);
    // 只拉了命中层容器：A 的 l0 与 B 的 l2，无多余层请求。
    expect(fixture.fetchLog.toSorted()).toEqual(["chunks/c_0_0_l0.dmap", "chunks/c_1_0_l2.dmap"]);

    // 进度口径：应载集 = {A,B}，两块均按期望层挂载 → 100%。
    const stats = layer.stats;
    expect(stats.totalInstances).toBe(10);
    expect(stats.loadedInstances).toBe(10);
    expect(stats.fraction).toBe(1);
    expect(stats.loadedChunks).toBe(2);
    layer.dispose();
  });

  it("接近升级 / 远离降级：换层挂载新对象并释放旧层 GPU 资源", async () => {
    const fixture = await buildTieredFixture(SPECS);
    const layer = new MapSceneLayer(fixture.pkg, fixture.sceneDoc, fixture.floors, layerOptions());
    let focus: Vec3 = { x: 0, y: 0, z: 0 };
    layer.attachCamera(topDownCamera());
    layer.setFocusProvider(() => focus);
    layer.update(0.3);
    await settle(layer);
    expect(mountedTags(fixture.floors).toSorted()).toEqual(["0_0@l0", "1_0@l2"]);

    // 记录首层几何，监听 dispose 事件验证释放配对。
    const geometries = new Map<object, { disposed: boolean }>();
    fixture.floors.root.traverse((object) => {
      const mesh = object as { geometry?: { addEventListener: Function } };
      if (mesh.geometry) {
        const state = { disposed: false };
        geometries.set(mesh.geometry, state);
        mesh.geometry.addEventListener("dispose", () => {
          state.disposed = true;
        });
      }
    });
    expect(geometries.size).toBe(2);

    // 视线中心移到 B：B 升级 l2→l0，A 降级 l0→l2。
    focus = { x: 1020, y: 0, z: 20 };
    layer.update(0.3);
    // 提交即采样：B 已挂 l2 但期望 l0 → 不计入 loaded，进度回落（当前应载集口径）。
    const midStats: ChunkStreamStats = layer.stats;
    expect(midStats.pendingChunks).toBe(2); // B@l0 升级 + A@l2 降级
    expect(midStats.totalInstances).toBe(10);
    expect(midStats.loadedInstances).toBe(4); // 仅 A（l0 ≤ 期望 l2）
    expect(midStats.fraction).toBeCloseTo(0.4, 5);
    await settle(layer);

    expect(mountedTags(fixture.floors).toSorted()).toEqual(["0_0@l2", "1_0@l0"]);
    // 首层的两个几何全部被 dispose（释放配对，无泄漏挂载）。
    expect([...geometries.values()].every((state) => state.disposed)).toBe(true);
    // 换层后 B 复用已缓存容器？——B 的 l0 首次拉取，fetch 新增 l0；A 的 l2 首次拉取。
    expect(fixture.fetchLog.filter((file) => file.includes("c_1_0")).toSorted()).toEqual([
      "chunks/c_1_0_l0.dmap",
      "chunks/c_1_0_l2.dmap",
    ]);
    expect(layer.stats.fraction).toBe(1);
    layer.dispose();
  });

  it("带边界迟滞：中带距离小幅往返不触发换层", async () => {
    const fixture = await buildTieredFixture(SPECS);
    const layer = new MapSceneLayer(fixture.pkg, fixture.sceneDoc, fixture.floors, layerOptions());
    let focus: Vec3 = { x: 0, y: 0, z: 0 };
    layer.attachCamera(topDownCamera());
    layer.setFocusProvider(() => focus);
    layer.update(0.3);
    await settle(layer);

    // 移到距 B 中心 500m（中带）：B 从 l2 升到 l1（500 < 600−60）。
    focus = { x: 520, y: 0, z: 20 };
    layer.update(0.3);
    await settle(layer);
    expect(mountedTags(fixture.floors)).toContain("1_0@l1");

    // 中带内往返（570 → 400 → 570）：均不越迟滞界，B 维持 l1。
    for (const x of [450, 570, 400, 560]) {
      focus = { x, y: 0, z: 20 };
      layer.update(0.3);
      await settle(layer);
      expect(mountedTags(fixture.floors)).toContain("1_0@l1");
    }
    const fetchesForB = fixture.fetchLog.filter((file) => file.includes("c_1_0"));
    // 整个往返过程 B 只拉过 l2 与 l1 两个容器（无 l0，无重复）。
    expect(fetchesForB.toSorted()).toEqual(["chunks/c_1_0_l1.dmap", "chunks/c_1_0_l2.dmap"]);
    layer.dispose();
  });

  it("离开渲染半径：卸载并从应载集剔除（进度分母归零）", async () => {
    const fixture = await buildTieredFixture(SPECS);
    const layer = new MapSceneLayer(fixture.pkg, fixture.sceneDoc, fixture.floors, layerOptions());
    let focus: Vec3 = { x: 0, y: 0, z: 0 };
    layer.attachCamera(topDownCamera());
    layer.setFocusProvider(() => focus);
    layer.update(0.3);
    await settle(layer);
    expect(layer.stats.loadedChunks).toBe(2);

    focus = { x: 10000, y: 0, z: 0 };
    layer.update(0.3);
    await settle(layer);
    expect(mountedTags(fixture.floors)).toEqual([]);
    expect(layer.stats.loadedChunks).toBe(0);
    // 应载集为空：分母 0，进度守卫为 1。
    expect(layer.stats.totalInstances).toBe(0);
    expect(layer.stats.fraction).toBe(1);
    layer.dispose();
  });

  it("空层（无可渲染几何）挂载为空对象不崩溃，升级恢复完整几何", async () => {
    // 远带（中心 ~720m → l2）但仍在渲染半径内。
    const specs: readonly FixtureChunkSpec[] = [
      { id: "9_9", boundsMin: [700, 0, 0], boundsMax: [740, 1, 40], instances: 2, emptyTiers: [2] },
    ];
    const fixture = await buildTieredFixture(specs);
    const layer = new MapSceneLayer(fixture.pkg, fixture.sceneDoc, fixture.floors, layerOptions());
    let focus: Vec3 = { x: 0, y: 0, z: 0 };
    layer.attachCamera(topDownCamera());
    layer.setFocusProvider(() => focus);
    layer.update(0.3);
    await settle(layer);

    // 远距 → 空层 l2：挂载空对象（无几何），进度仍按清单实例份额计满。
    const tags = mountedTags(fixture.floors);
    expect(tags).toEqual(["9_9@l2"]);
    expect(layer.stats.fraction).toBe(1);

    // 接近 → 升级 l0：完整几何替换空对象。
    focus = { x: 720, y: 0, z: 20 };
    layer.update(0.3);
    await settle(layer);
    expect(mountedTags(fixture.floors)).toEqual(["9_9@l0"]);
    expect(layer.stats.fraction).toBe(1);
    layer.dispose();
  });
});

describe("MapSceneLayer · v3 单层包（无 lods 表）行为不变", () => {
  it("任意距离恒挂唯一层，进度口径一致", async () => {
    const fixture = await buildTieredFixture(SPECS, { singleTier: true });
    const layer = new MapSceneLayer(fixture.pkg, fixture.sceneDoc, fixture.floors, layerOptions());
    let focus: Vec3 = { x: 0, y: 0, z: 0 };
    layer.attachCamera(topDownCamera());
    layer.setFocusProvider(() => focus);
    layer.update(0.3);
    await settle(layer);

    // 远 B 也没有分层可换：两层 chunk 都挂各自唯一容器载荷。
    expect(mountedTags(fixture.floors).toSorted()).toEqual(["0_0@l0", "1_0@l0"]);
    expect(fixture.fetchLog.toSorted()).toEqual(["chunks/c_0_0.dmap", "chunks/c_1_0.dmap"]);
    expect(layer.stats.fraction).toBe(1);

    // 视线中心移到 B：无换层任务（层不可切换）。
    focus = { x: 1020, y: 0, z: 20 };
    layer.update(0.3);
    await settle(layer);
    expect(mountedTags(fixture.floors).toSorted()).toEqual(["0_0@l0", "1_0@l0"]);
    expect(fixture.fetchLog.length).toBe(2);
    layer.dispose();
  });
});

/** 手动（延迟执行）调度器：排空请求只捕获不执行，测试显式驱动装配时点。 */
function deferredScheduler() {
  const pending: (() => void)[] = [];
  return {
    scheduler: (run: () => void) => {
      pending.push(run);
    },
    flush() {
      while (pending.length > 0) {
        pending.shift()!();
      }
    },
  };
}

/** 等微任务排空（fetch / 解析 promise 链推进）。 */
const microtasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("MapSceneLayer · 帧预算装配队列（拉取与装配分段）", () => {
  it("拉取完成与装配分段：pending 口径含装配在途，排空后挂载、进度 100%", async () => {
    const fixture = await buildTieredFixture(SPECS);
    const deferred = deferredScheduler();
    const layer = new MapSceneLayer(fixture.pkg, fixture.sceneDoc, fixture.floors, {
      ...layerOptions(),
      assemblyScheduler: deferred.scheduler,
    });
    const focus: Vec3 = { x: 0, y: 0, z: 0 };
    layer.attachCamera(topDownCamera());
    layer.setFocusProvider(() => focus);

    layer.update(0.3); // 规划 + 提交（update 内的 tick 时队列为空）
    await microtasks(); // 池任务拉取完成 → 装配队列入队
    const midStats = layer.stats;
    // 池已排空（拉取即完成）、装配在途 2 条：pending 必须计入装配队列，
    // 否则进度 UI 会在装配完成前误报「已就位」。
    expect(midStats.pendingChunks).toBe(2);
    expect(midStats.loadedChunks).toBe(0);
    expect(mountedTags(fixture.floors)).toEqual([]);

    deferred.flush(); // 排空：启动解析
    await microtasks(); // 解析完成 → ready
    deferred.flush(); // 排空：装配挂载
    await microtasks();
    await settle(layer);
    expect(mountedTags(fixture.floors).toSorted()).toEqual(["0_0@l0", "1_0@l2"]);
    expect(layer.stats.fraction).toBe(1);
    expect(layer.stats.pendingChunks).toBe(0);
    layer.dispose();
  });

  it("待装配条目随应载集离开被清扫：不挂载、无残留 pending、无重复拉取", async () => {
    const fixture = await buildTieredFixture(SPECS);
    const deferred = deferredScheduler();
    const layer = new MapSceneLayer(fixture.pkg, fixture.sceneDoc, fixture.floors, {
      ...layerOptions(),
      assemblyScheduler: deferred.scheduler,
    });
    let focus: Vec3 = { x: 0, y: 0, z: 0 };
    layer.attachCamera(topDownCamera());
    layer.setFocusProvider(() => focus);

    layer.update(0.3); // 提交 A@l0 + B@l2
    await microtasks(); // 拉取完成 → 入队（排空请求挂起，装配未开始）
    deferred.flush(); // 启动解析（合成 GLB 在微任务内完成）
    // 视线中心跳出渲染半径：规划把两块移出应载集，update 内的 tick
    // 随即清扫 parsing 条目（drop(null)）；解析完成后场景经 drop 释放。
    focus = { x: 10000, y: 0, z: 0 };
    layer.update(0.3);
    await microtasks(); // 在途解析完成 → 迟到场景走 drop 释放路径
    deferred.flush(); // 迟到的排空请求：无动作
    await settle(layer);

    expect(mountedTags(fixture.floors)).toEqual([]);
    expect(layer.stats.loadedChunks).toBe(0);
    expect(layer.stats.pendingChunks).toBe(0);
    // 应载集为空：分母归零，进度守卫为 1。
    expect(layer.stats.totalInstances).toBe(0);
    expect(layer.stats.fraction).toBe(1);
    // 拉取阶段各容器只拉过一次（清扫丢弃不重拉）。
    expect(fixture.fetchLog.length).toBe(2);
    layer.dispose();
  });

  it("装配在途去重：池槽位释放后规划不重复提交同层任务", async () => {
    const fixture = await buildTieredFixture(SPECS);
    const deferred = deferredScheduler();
    const layer = new MapSceneLayer(fixture.pkg, fixture.sceneDoc, fixture.floors, {
      ...layerOptions(),
      assemblyScheduler: deferred.scheduler,
    });
    const focus: Vec3 = { x: 0, y: 0, z: 0 };
    layer.attachCamera(topDownCamera());
    layer.setFocusProvider(() => focus);

    layer.update(0.3); // 提交 A@l0 + B@l2
    await microtasks(); // 拉取完成 → 入队（池任务已结算、键位释放）
    // 再次规划（装配仍在途）：不得因池键释放而重复提交同层任务。
    layer.update(0.3);
    await microtasks();
    // 仍是 2 条装配在途（重复提交会在此窗口多出池任务）。
    expect(layer.stats.pendingChunks).toBe(2);

    deferred.flush();
    await microtasks();
    deferred.flush();
    await settle(layer);
    // 每块恰挂一层，无重复装配。
    expect(mountedTags(fixture.floors).toSorted()).toEqual(["0_0@l0", "1_0@l2"]);
    expect(layer.stats.fraction).toBe(1);
    layer.dispose();
  });
});

describe("disposeObject3D · 材质纹理槽位释放", () => {
  it("释放材质时一并释放其纹理引用", () => {
    const object = new Object3D();
    const mesh = new Object3D();
    const geometry = new BufferGeometry();
    const material = new MeshBasicMaterial();
    const texture = new Texture();
    material.map = texture;
    const disposed = { geometry: false, material: false, texture: false };
    geometry.addEventListener("dispose", () => {
      disposed.geometry = true;
    });
    material.addEventListener("dispose", () => {
      disposed.material = true;
    });
    texture.addEventListener("dispose", () => {
      disposed.texture = true;
    });
    (mesh as unknown as { geometry: unknown }).geometry = geometry;
    (mesh as unknown as { material: unknown }).material = material;
    object.add(mesh);
    disposeObject3D(object);
    expect(disposed.geometry).toBe(true);
    expect(disposed.material).toBe(true);
    expect(disposed.texture).toBe(true);
  });
});

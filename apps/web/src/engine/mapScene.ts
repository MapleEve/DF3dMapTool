import {
  Frustum,
  Group,
  InstancedMesh,
  Matrix4,
  type Object3D,
  type PerspectiveCamera,
} from 'three';
import type { Vec3 } from '@/common/geometry';
import { DRACO_GLTF_CONFIG } from 'three/addons/loaders/DRACOLoader.js';
import {
  buildChunkRecords,
  selectChunks,
  sortByDistance,
  type ChunkRecord,
  type FrustumPlanes,
} from '@/map/chunkGrid';
import type { DmapMapBundle, SceneDoc } from './mapBundle';
import { ChunkGltfParser, disposeObject3D, splitInstancedMeshByFloor } from './gltf';
import { deriveFloorBands, floorForY, type FloorBand } from './floorBands';
import type { FloorManager } from './floorManager';
import type { EngineLayer } from './SceneManager';

/**
 * 地图图层：清单驱动的 chunk 流式加载/卸载。
 *
 * - chunk 选择由纯逻辑层 map/chunkGrid 提供：自建空间分桶包围盒
 *   + 相机视锥 + 渲染半径（迟滞带防抖）；
 * - 加载队列按与视线中心的距离排序，限流并发；
 * - 载入后按实例高度把网格拆进楼层组，交 FloorManager 管显隐；
 * - 渲染距离可调（对齐渲染距离设置项，联动加载半径）。
 */
export interface MapSceneLayerOptions {
  /** 渲染半径（米），对齐渲染距离设置项。 */
  readonly renderDistance?: number;
  /** 迟滞余量系数（相对渲染半径）。 */
  readonly hysteresisRatio?: number;
  /** Draco 解码器配置（缺省用 three 自带的 glTF 变体）。 */
  readonly decoder?: string | typeof DRACO_GLTF_CONFIG;
  /** 并发加载数。 */
  readonly maxConcurrentLoads?: number;
  /** 流式规划间隔（秒）。 */
  readonly streamingInterval?: number;
}

export interface ChunkStreamStats {
  readonly loadedChunks: number;
  readonly pendingChunks: number;
  readonly totalChunks: number;
  readonly loadedInstances: number;
}

export type ChunkProgressListener = (stats: ChunkStreamStats) => void;

/** three 自带的 glTF 变体解码器（模块相对 URL，构建期改写为本地资产）。 */
const DRACO_GLTF_DEFAULT: typeof DRACO_GLTF_CONFIG = { ...DRACO_GLTF_CONFIG };

const DEFAULTS: Required<MapSceneLayerOptions> = {
  renderDistance: 700,
  hysteresisRatio: 0.2,
  decoder: DRACO_GLTF_DEFAULT,
  maxConcurrentLoads: 4,
  streamingInterval: 0.2,
};

interface LoadedChunk {
  readonly id: string;
  readonly parts: readonly { object: Object3D; floor: number }[];
  instances: number;
}

export class MapSceneLayer implements EngineLayer {
  readonly id = 'map-scene';
  readonly root: Group = new Group();

  readonly #bundle: DmapMapBundle;
  readonly #sceneDoc: SceneDoc;
  readonly #floorManager: FloorManager;
  readonly #options: Required<MapSceneLayerOptions>;
  readonly #parser: ChunkGltfParser;
  readonly #records: ChunkRecord[];
  readonly #bands: FloorBand[];
  readonly #loaded = new Map<string, LoadedChunk>();
  readonly #pending = new Set<string>();
  readonly #frustum = new Frustum();
  readonly #projectionMatrix = new Matrix4();
  readonly #abort = new AbortController();

  #camera: PerspectiveCamera | null = null;
  #focusProvider: (() => Vec3) | null = null;
  #queue: ChunkRecord[] = [];
  #activeLoads = 0;
  #timeSincePlan = Number.POSITIVE_INFINITY;
  #renderDistance: number;
  #progressListener: ChunkProgressListener | null = null;
  #disposed = false;

  constructor(
    bundle: DmapMapBundle,
    sceneDoc: SceneDoc,
    floorManager: FloorManager,
    options: MapSceneLayerOptions = {},
  ) {
    this.#bundle = bundle;
    this.#sceneDoc = sceneDoc;
    this.#floorManager = floorManager;
    this.#options = { ...DEFAULTS, ...options };
    this.#renderDistance = this.#options.renderDistance;
    this.#parser = new ChunkGltfParser(this.#options.decoder);
    this.#records = buildChunkRecords(bundle.manifest.chunkBounds);
    this.#bands = deriveFloorBands(sceneDoc.floorValues, sceneDoc.floorTriggers);

    this.root.name = `map-${bundle.mapCode}`;
    this.root.add(this.#floorManager.root);
    // 初始即排空一次规划，让首个视图就位前就开始拉取
    this.#timeSincePlan = this.#options.streamingInterval;
  }

  get bands(): readonly FloorBand[] {
    return this.#bands;
  }

  /** 场景元数据（bounds/触发体），供 POI 楼层过滤与路线层复用。 */
  get sceneDoc(): SceneDoc {
    return this.#sceneDoc;
  }

  get chunkTotal(): number {
    return this.#records.length;
  }

  /** 当前流式加载统计（进度条/状态栏用）。 */
  get stats(): ChunkStreamStats {
    let loadedInstances = 0;
    for (const chunk of this.#loaded.values()) {
      loadedInstances += chunk.instances;
    }
    return {
      loadedChunks: this.#loaded.size,
      pendingChunks: this.#pending.size,
      totalChunks: this.#records.length,
      loadedInstances,
    };
  }

  setRenderDistance(meters: number): void {
    this.#renderDistance = Math.max(meters, 50);
  }

  get renderDistance(): number {
    return this.#renderDistance;
  }

  /** 供加载进度 UI 订阅（首屏加载与增量加载共用）。 */
  onProgress(listener: ChunkProgressListener | null): void {
    this.#progressListener = listener;
  }

  /** 相机就位后调用；帧循环内用于视锥规划。 */
  attachCamera(camera: PerspectiveCamera): void {
    this.#camera = camera;
  }

  /** 视线中心提供者（缺省用相机位置；轨道相机可传注视点）。 */
  setFocusProvider(provider: (() => Vec3) | null): void {
    this.#focusProvider = provider;
  }

  /** 预热全部容器（可选）：后台把其余分片容器拉全。 */
  preload(): Promise<void> {
    return this.#bundle.preloadAllContainers().then(() => undefined);
  }

  update(deltaSeconds: number): void {
    if (this.#disposed || this.#camera === null) {
      return;
    }
    this.#timeSincePlan += deltaSeconds;
    if (this.#timeSincePlan >= this.#options.streamingInterval) {
      this.#timeSincePlan = 0;
      this.#plan();
    }
    this.#pumpQueue();
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#abort.abort();
    this.#queue = [];
    this.#pending.clear();
    for (const chunk of this.#loaded.values()) {
      this.#releaseChunkObjects(chunk);
    }
    this.#loaded.clear();
    this.root.clear();
    this.#parser.dispose();
  }

  #plan(): void {
    const camera = this.#camera;
    if (camera === null) {
      return;
    }
    camera.updateMatrixWorld();
    this.#projectionMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this.#frustum.setFromProjectionMatrix(this.#projectionMatrix);
    const planes: FrustumPlanes = this.#frustum.planes.map((plane) => [
      plane.normal.x,
      plane.normal.y,
      plane.normal.z,
      plane.constant,
    ]);
    const focus = this.#focusProvider?.() ?? camera.position;
    const loadedIds = new Set(this.#loaded.keys());
    const { toLoad, toUnload } = selectChunks({
      chunks: this.#records,
      planes,
      center: focus,
      radius: this.#renderDistance,
      hysteresis: this.#renderDistance * this.#options.hysteresisRatio,
      loadedIds,
    });

    for (const id of toUnload) {
      const chunk = this.#loaded.get(id);
      if (chunk !== undefined) {
        this.#releaseChunkObjects(chunk);
        this.#loaded.delete(id);
        this.#emitProgress();
      }
    }

    if (toLoad.length > 0) {
      const nextQueue = this.#queue.filter((chunk) => !this.#pending.has(chunk.id));
      const incoming = sortByDistance(
        toLoad.filter((chunk) => !this.#pending.has(chunk.id)),
        focus,
      );
      this.#queue = [...incoming, ...nextQueue];
    }
  }

  #pumpQueue(): void {
    while (
      !this.#disposed &&
      this.#activeLoads < this.#options.maxConcurrentLoads &&
      this.#queue.length > 0
    ) {
      const next = this.#queue.shift();
      if (next === undefined || this.#pending.has(next.id) || this.#loaded.has(next.id)) {
        continue;
      }
      this.#pending.add(next.id);
      this.#activeLoads += 1;
      void this.#loadChunk(next);
    }
  }

  async #loadChunk(info: ChunkRecord): Promise<void> {
    try {
      const bytes = await this.#bundle.readChunkBytes(info);
      if (this.#disposed || this.#abort.signal.aborted) {
        return;
      }
      const scene = await this.#parser.parseGlb(bytes);
      if (this.#disposed || this.#abort.signal.aborted) {
        disposeObject3D(scene);
        return;
      }
      const parts: { object: Object3D; floor: number }[] = [];
      for (const node of [...scene.children]) {
        if (node instanceof InstancedMesh) {
          const splits = splitInstancedMeshByFloor(node, this.#bands);
          if (splits.length > 1) {
            // 拆分后原实例属性不再使用，主动释放
            node.dispose();
          }
          for (const part of splits) {
            parts.push({ object: part.mesh, floor: part.floor });
          }
        } else {
          parts.push({ object: node, floor: this.#floorForObject(node) });
        }
      }
      for (const part of parts) {
        this.#floorManager.register(part.object, part.floor);
      }
      const instances = [...scene.children].reduce(
        (sum, node) => sum + (node instanceof InstancedMesh ? node.count : 1),
        0,
      );
      this.#loaded.set(info.id, { id: info.id, parts, instances });
      this.#emitProgress();
    } catch (error) {
      console.error(`chunk ${info.id} 加载失败`, error);
    } finally {
      this.#pending.delete(info.id);
      this.#activeLoads -= 1;
    }
  }

  #floorForObject(node: Object3D): number {
    return floorForY(this.#bands, node.position.y);
  }

  #releaseChunkObjects(chunk: LoadedChunk): void {
    for (const part of chunk.parts) {
      this.#floorManager.unregister(part.object, part.floor);
      part.object.removeFromParent();
      disposeObject3D(part.object);
    }
  }

  #emitProgress(): void {
    if (this.#progressListener === null) {
      return;
    }
    let loadedInstances = 0;
    for (const chunk of this.#loaded.values()) {
      loadedInstances += chunk.instances;
    }
    this.#progressListener({
      loadedChunks: this.#loaded.size,
      pendingChunks: this.#pending.size,
      totalChunks: this.#records.length,
      loadedInstances,
    });
  }
}

import {
  Frustum,
  Group,
  InstancedMesh,
  Matrix4,
  type Object3D,
  type PerspectiveCamera,
} from "three";
import type { Vec3 } from "@/common/geometry";
import { DRACO_GLTF_CONFIG } from "three/addons/loaders/DRACOLoader.js";
import {
  StreamProgressAggregator,
  TaskCancelledError,
  TaskPool,
  type DmapMapPackage,
} from "@df3dmaptool/dmap";
import {
  buildChunkRecords,
  selectChunks,
  sortByDistance,
  type ChunkRecord,
  type FrustumPlanes,
} from "@/map/chunkGrid";
import type { SceneDoc } from "./mapBundle";
import { ChunkGltfParser, disposeObject3D, splitInstancedMeshByFloor } from "./gltf";
import { deriveFloorBands, floorForY, type FloorBand } from "./floorBands";
import type { FloorManager } from "./floorManager";
import type { EngineLayer } from "./SceneManager";

/**
 * 地图图层：清单驱动的分块流式加载/卸载。
 *
 * - chunk 选择由纯逻辑层 map/chunkGrid 提供：自建空间分桶包围盒
 *   + 相机视锥 + 渲染半径（迟滞带防抖）；
 * - 命中的分块以独立容器提交到并发任务池（TaskPool）：
 *   按到视线中心的距离排序、并发 6 路限流、失败自动重试（带指数退避）；
 *   重试耗尽的分块进入指数冷却，避免持续失败时形成请求风暴；
 * - 每条流完成即把实例份额计入跨流进度聚合器（已载实例/总实例）；
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
  /** 并发拉取的分块容器数。 */
  readonly maxConcurrentLoads?: number;
  /** 单个分块容器加载失败后的附加尝试次数。 */
  readonly chunkRetries?: number;
  /** 池内单次重试前的基础退避毫秒数。 */
  readonly chunkRetryDelayMs?: number;
  /** 流式规划间隔（秒）。 */
  readonly streamingInterval?: number;
}

export interface ChunkStreamStats {
  readonly loadedChunks: number;
  readonly pendingChunks: number;
  readonly totalChunks: number;
  readonly loadedInstances: number;
  readonly totalInstances: number;
  /** 总进度：已载实例 / 总实例（跨流聚合）。 */
  readonly fraction: number;
  /** 重试耗尽、处于失败冷却中的分块数。 */
  readonly failedChunks: number;
}

export type ChunkProgressListener = (stats: ChunkStreamStats) => void;

/** three 自带的 glTF 变体解码器（模块相对 URL，构建期改写为本地资产）。 */
const DRACO_GLTF_DEFAULT: typeof DRACO_GLTF_CONFIG = { ...DRACO_GLTF_CONFIG };

const DEFAULTS: Required<MapSceneLayerOptions> = {
  renderDistance: 700,
  hysteresisRatio: 0.2,
  decoder: DRACO_GLTF_DEFAULT,
  maxConcurrentLoads: 6,
  chunkRetries: 1,
  chunkRetryDelayMs: 500,
  streamingInterval: 0.2,
};

/** 分块重试耗尽后的冷却基数（毫秒），按连续失败次数指数放大。 */
const FAILURE_COOLDOWN_BASE_MS = 1000;
/** 单个分块的重试冷却上限（毫秒）。 */
const FAILURE_COOLDOWN_MAX_MS = 30000;

interface LoadedChunk {
  readonly id: string;
  readonly parts: readonly { object: Object3D; floor: number }[];
  readonly instances: number;
}

export class MapSceneLayer implements EngineLayer {
  readonly id = "map-scene";
  readonly root: Group = new Group();

  readonly #pkg: DmapMapPackage;
  readonly #sceneDoc: SceneDoc;
  readonly #floorManager: FloorManager;
  readonly #options: Required<MapSceneLayerOptions>;
  readonly #parser: ChunkGltfParser;
  readonly #records: ChunkRecord[];
  readonly #bands: FloorBand[];
  readonly #pool: TaskPool;
  readonly #progress: StreamProgressAggregator;
  readonly #loaded = new Map<string, LoadedChunk>();
  /** 重试耗尽分块的连续失败次数（成功后清除）。 */
  readonly #failureStreaks = new Map<string, number>();
  /** 重试耗尽分块的最早重新提交时间（epoch 毫秒）。 */
  readonly #retryAfter = new Map<string, number>();
  readonly #frustum = new Frustum();
  readonly #projectionMatrix = new Matrix4();
  readonly #abort = new AbortController();

  #camera: PerspectiveCamera | null = null;
  #focusProvider: (() => Vec3) | null = null;
  #timeSincePlan = Number.POSITIVE_INFINITY;
  #renderDistance: number;
  #progressListener: ChunkProgressListener | null = null;
  #disposed = false;

  constructor(
    pkg: DmapMapPackage,
    sceneDoc: SceneDoc,
    floorManager: FloorManager,
    options: MapSceneLayerOptions = {},
  ) {
    this.#pkg = pkg;
    this.#sceneDoc = sceneDoc;
    this.#floorManager = floorManager;
    this.#options = { ...DEFAULTS, ...options };
    this.#renderDistance = this.#options.renderDistance;
    this.#parser = new ChunkGltfParser(this.#options.decoder);
    this.#records = buildChunkRecords(pkg.manifest.chunks);
    this.#bands = deriveFloorBands(sceneDoc.floorValues, sceneDoc.floorTriggers);
    this.#pool = new TaskPool({
      concurrency: this.#options.maxConcurrentLoads,
      retries: this.#options.chunkRetries,
      retryDelayMs: this.#options.chunkRetryDelayMs,
    });
    this.#progress = new StreamProgressAggregator(pkg.manifest.counts.instances);

    this.root.name = `map-${pkg.mapCode}`;
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
    return {
      loadedChunks: this.#loaded.size,
      pendingChunks: this.#pool.queuedCount + this.#pool.runningCount,
      totalChunks: this.#records.length,
      loadedInstances: this.#progress.loaded,
      totalInstances: this.#progress.total,
      fraction: this.#progress.fraction,
      failedChunks: this.#failureStreaks.size,
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

  /**
   * 预热（可选）：把全部分块容器提交到并发池后台拉取。
   * 仅负责提交任务、立即返回——不等待拉取完成（完成进度经 onProgress 观测）。
   */
  preload(): void {
    for (const record of this.#records) {
      if (!this.#loaded.has(record.id) && !this.#pool.has(record.id)) {
        void this.#submitLoad(record, Number.POSITIVE_INFINITY);
      }
    }
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
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#abort.abort();
    this.#pool.clear();
    for (const chunk of this.#loaded.values()) {
      this.#releaseChunkObjects(chunk);
    }
    this.#loaded.clear();
    this.#failureStreaks.clear();
    this.#retryAfter.clear();
    this.root.clear();
    this.#parser.dispose();
  }

  #plan(): void {
    const camera = this.#camera;
    if (camera === null) {
      return;
    }
    camera.updateMatrixWorld();
    this.#projectionMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
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
        this.#progress.report(-chunk.instances);
        this.#emitProgress();
      }
    }

    // 新命中的分块按距离排序提交并发池（已在池中/已载的由提交侧去重；
    // 失败冷却中的分块暂缓提交，冷却到期后下一轮规划自动重新命中）。
    const now = Date.now();
    const incoming = sortByDistance(
      toLoad.filter(
        (chunk) => !this.#pool.has(chunk.id) && (this.#retryAfter.get(chunk.id) ?? 0) <= now,
      ),
      focus,
    );
    for (const record of incoming) {
      // 优先级 = 到视线中心距离的平方（池取数值最小者先执行）。
      const dx = record.center.x - focus.x;
      const dy = record.center.y - focus.y;
      const dz = record.center.z - focus.z;
      const priority = dx * dx + dy * dy + dz * dz;
      void this.#submitLoad(record, priority);
    }
    if (incoming.length > 0) {
      // 提交即推送一次统计：让流式进度 UI 立刻看到 pending 份额。
      this.#emitProgress();
    }
  }

  /** 提交一个分块加载任务（拉取分块容器 → 解析 GLB → 楼层拆分挂载）。 */
  #submitLoad(record: ChunkRecord, priority: number): Promise<void> {
    return this.#pool
      .submit(record.id, priority, async () => {
        if (this.#disposed || this.#abort.signal.aborted) {
          return;
        }
        const bytes = await this.#pkg.readChunk(record);
        if (this.#disposed || this.#abort.signal.aborted) {
          return;
        }
        const scene = await this.#parser.parseGlb(bytes);
        if (this.#disposed || this.#abort.signal.aborted) {
          disposeObject3D(scene);
          return;
        }
        const parts: { object: Object3D; floor: number }[] = [];
        // 实例份额在挂载前统计：register 会把对象移出解析场景，
        // 挂载后再数 scene.children 会把单楼层分块（拆分原样返回原网格）
        // 全部漏记成 0，跨流聚合进度随之失真。
        let instances = 0;
        for (const node of scene.children) {
          if (node instanceof InstancedMesh) {
            instances += node.count;
            const splits = splitInstancedMeshByFloor(node, this.#bands);
            if (splits.length > 1) {
              // 拆分后原实例属性不再使用，主动释放
              node.dispose();
            }
            for (const part of splits) {
              parts.push({ object: part.mesh, floor: part.floor });
            }
          } else {
            instances += 1;
            parts.push({ object: node, floor: this.#floorForObject(node) });
          }
        }
        for (const part of parts) {
          this.#floorManager.register(part.object, part.floor);
        }
        this.#loaded.set(record.id, { id: record.id, parts, instances });
        this.#failureStreaks.delete(record.id);
        this.#retryAfter.delete(record.id);
        this.#progress.report(instances);
        this.#emitProgress();
      })
      .catch((error: unknown) => {
        if (error instanceof TaskCancelledError) {
          // 换图/释放时排队任务被丢弃属预期流程，不计失败。
          return;
        }
        if (this.#disposed) {
          return;
        }
        // 重试耗尽：进入指数冷却后再由规划重新提交，避免持续失败时
        // 每 0.2s 重提同一分块形成请求风暴与错误刷屏。
        const streak = (this.#failureStreaks.get(record.id) ?? 0) + 1;
        this.#failureStreaks.set(record.id, streak);
        const cooldownMs = Math.min(
          FAILURE_COOLDOWN_BASE_MS * 2 ** (streak - 1),
          FAILURE_COOLDOWN_MAX_MS,
        );
        this.#retryAfter.set(record.id, Date.now() + cooldownMs);
        this.#emitProgress();
        console.error(
          `chunk ${record.id} 加载失败（连续第 ${streak} 次，${Math.round(cooldownMs / 1000)}s 后重试）`,
          error,
        );
      });
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
    if (this.#disposed || this.#progressListener === null) {
      return;
    }
    this.#progressListener(this.stats);
  }
}

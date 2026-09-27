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
import { TaskCancelledError, TaskPool, type DmapMapPackage } from "@df3dmaptool/dmap";
import {
  buildChunkRecords,
  distanceToChunk,
  lodLevelForDistance,
  selectChunks,
  type ChunkRecord,
  type FrustumPlanes,
  type LodThresholds,
} from "@/map/chunkGrid";
import type { SceneDoc } from "./mapBundle";
import { ChunkGltfParser, disposeObject3D, splitInstancedMeshByFloor } from "./gltf";
import { deriveFloorBands, floorForY, type FloorBand } from "./floorBands";
import type { FloorManager } from "./floorManager";
import type { EngineLayer } from "./SceneManager";

/**
 * 地图图层：清单驱动的分块流式加载/卸载 + 距离驱动的 LOD 分层。
 *
 * - chunk 选择由纯逻辑层 map/chunkGrid 提供：自建空间分桶包围盒
 *   + 相机视锥 + 渲染半径（迟滞带防抖）+ 中心距离分带
 *   （近细远粗，带边界迟滞防抖，见 lodLevelForDistance）；
 * - v4 分层清单（chunks[].lods）按层各拉一个容器：远处先载低模层，
 *   相机接近自动升级高模并释放低模层的实例化网格显存，
 *   远离后降级回收高模；v3 单层包不分级，行为与既有实现一致；
 * - 命中的分块/换层任务以独立键提交并发池（TaskPool，键 = chunk@层）：
 *   按到视线中心的距离排序、并发 6 路限流、失败自动重试（带指数退避），
 *   降级任务（纯内存回收）一律排在载入/升级之后；
 *   重试耗尽的分块进入指数冷却，避免持续失败时形成请求风暴；
 * - 换层复用已打开的层容器缓存（升级不重拉字节），旧层对象经
 *   disposeObject3D 释放几何/材质/纹理引用；
 * - 载入后按实例高度把网格拆进楼层组，交 FloorManager 管显隐；
 * - 进度按「当前应载集」口径：应载集 = 本轮规划保留的分块，
 *   分母为其实例份额（清单声明值，跨层一致），分子为其中已按
 *   期望层级或更细层级挂载的份额——升级期间分数回落、完成后回到 100%；
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
  /** LOD 分带阈值（米，升序 [近带上界, 中带上界]），缺省 [300, 600]。 */
  readonly lodThresholds?: LodThresholds;
  /** LOD 分带迟滞余量（米），缺省 60。 */
  readonly lodHysteresis?: number;
}

export interface ChunkStreamStats {
  /** 当前已挂载分块数（任意层级）。 */
  readonly loadedChunks: number;
  readonly pendingChunks: number;
  readonly totalChunks: number;
  /** 应载集中已按期望层级或更细层级挂载的实例份额。 */
  readonly loadedInstances: number;
  /** 当前应载集的实例份额总数。 */
  readonly totalInstances: number;
  /** 总进度：应载集已就位份额 / 应载集份额（跨流聚合）。 */
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
  lodThresholds: [300, 600],
  lodHysteresis: 60,
};

/** 分块重试耗尽后的冷却基数（毫秒），按连续失败次数指数放大。 */
const FAILURE_COOLDOWN_BASE_MS = 1000;
/** 单个分块的重试冷却上限（毫秒）。 */
const FAILURE_COOLDOWN_MAX_MS = 30000;
/** 降级任务的优先级惩罚：确保任何载入/升级都先于纯内存回收。 */
const DOWNGRADE_PRIORITY_PENALTY = 1e9;

interface LoadedChunk {
  readonly id: string;
  /** 当前挂载的细节层级（0 = 最高细节）。 */
  readonly level: number;
  readonly parts: readonly { object: Object3D; floor: number }[];
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
  readonly #recordsById: ReadonlyMap<string, ChunkRecord>;
  readonly #bands: FloorBand[];
  readonly #pool: TaskPool;
  readonly #loaded = new Map<string, LoadedChunk>();
  /** 本轮规划的应载集：chunk id → 期望细节层级（单层数据包恒 0）。 */
  readonly #desired = new Map<string, number>();
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
    this.#recordsById = new Map(this.#records.map((record) => [record.id, record]));
    this.#bands = deriveFloorBands(sceneDoc.floorValues, sceneDoc.floorTriggers);
    const [lodNear, lodFar] = this.#options.lodThresholds;
    if (
      !Number.isFinite(lodNear) ||
      !Number.isFinite(lodFar) ||
      lodNear <= 0 ||
      lodFar <= lodNear
    ) {
      throw new RangeError(`lodThresholds 必须为升序正数，实际: ${lodNear}/${lodFar}`);
    }
    if (!Number.isFinite(this.#options.lodHysteresis) || this.#options.lodHysteresis < 0) {
      throw new RangeError(`lodHysteresis 必须为非负数，实际: ${this.#options.lodHysteresis}`);
    }
    this.#pool = new TaskPool({
      concurrency: this.#options.maxConcurrentLoads,
      retries: this.#options.chunkRetries,
      retryDelayMs: this.#options.chunkRetryDelayMs,
    });

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

  /** 当前流式加载统计（进度条/状态栏用；实例份额按当前应载集口径）。 */
  get stats(): ChunkStreamStats {
    let total = 0;
    let loaded = 0;
    for (const [id, desiredLevel] of this.#desired) {
      const record = this.#recordsById.get(id);
      if (record === undefined) {
        continue;
      }
      total += record.instances;
      const mounted = this.#loaded.get(id);
      if (mounted !== undefined && mounted.level <= desiredLevel) {
        loaded += record.instances;
      }
    }
    return {
      loadedChunks: this.#loaded.size,
      pendingChunks: this.#pool.queuedCount + this.#pool.runningCount,
      totalChunks: this.#records.length,
      loadedInstances: loaded,
      totalInstances: total,
      fraction: total > 0 ? Math.min(1, loaded / total) : 1,
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
   * 预热（可选）：把全部分块按当前分带层级提交到并发池后台拉取。
   * 相机/视线中心未就位时按最高细节层提交。仅负责提交任务、立即返回
   * ——不等待拉取完成（完成进度经 onProgress 观测）。
   */
  preload(): void {
    const focus = this.#focusProvider?.() ?? this.#camera?.position ?? null;
    for (const record of this.#records) {
      const level = focus === null ? 0 : this.#desiredLevelFor(record, focus);
      this.#desired.set(record.id, level);
      if (this.#loaded.get(record.id)?.level === level) {
        continue;
      }
      if (this.#pool.has(`${record.id}@${level}`)) {
        continue;
      }
      void this.#submitLoad(record, level, Number.POSITIVE_INFINITY);
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
    this.#desired.clear();
    this.#failureStreaks.clear();
    this.#retryAfter.clear();
    this.root.clear();
    this.#parser.dispose();
  }

  /** 期望细节层级：单层数据包（无分层表）恒 0；分层包按中心距离分带（含迟滞）。 */
  #desiredLevelFor(record: ChunkRecord, focus: Vec3, currentLevel?: number): number {
    if (!record.hasLodTiers) {
      return 0;
    }
    // 分带距离 = 焦点到 chunk 中心（与半径判定的最近点口径互补）。
    return lodLevelForDistance(
      distanceToChunk(focus, record),
      { thresholds: this.#options.lodThresholds, hysteresis: this.#options.lodHysteresis },
      currentLevel,
    );
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
    const currentLevels = new Map<string, number>();
    for (const chunk of this.#loaded.values()) {
      currentLevels.set(chunk.id, chunk.level);
    }
    const { toLoad, toUnload, desiredLevels } = selectChunks({
      chunks: this.#records,
      planes,
      center: focus,
      radius: this.#renderDistance,
      hysteresis: this.#renderDistance * this.#options.hysteresisRatio,
      loadedIds,
      lod: {
        thresholds: this.#options.lodThresholds,
        hysteresis: this.#options.lodHysteresis,
      },
      currentLevels,
    });

    for (const id of toUnload) {
      const chunk = this.#loaded.get(id);
      if (chunk !== undefined) {
        this.#releaseChunkObjects(chunk);
        this.#loaded.delete(id);
      }
      this.#desired.delete(id);
      this.#emitProgress();
    }

    // 保留集：刷新应载集与期望层级（单层包恒 0）；
    // 已不在保留集内的旧期望（如 preload 预热过的分块）同步剪除，
    // 保持进度分母 = 当前应载集。
    for (const id of this.#desired.keys()) {
      if (!desiredLevels.has(id)) {
        this.#desired.delete(id);
      }
    }
    for (const [id, level] of desiredLevels) {
      const record = this.#recordsById.get(id);
      if (record === undefined) {
        continue;
      }
      this.#desired.set(id, record.hasLodTiers ? level : 0);
    }

    // 待提交任务：新命中分块（任意层）+ 已载分块的换层（升级/降级）。
    // 已在池中的按（chunk@层）键去重；失败冷却中的分块暂缓提交，
    // 冷却到期后下一轮规划自动重新命中。
    const now = Date.now();
    const submissions: { record: ChunkRecord; level: number; priority: number }[] = [];
    for (const [id, desiredLevel] of this.#desired) {
      const record = this.#recordsById.get(id);
      if (record === undefined) {
        continue;
      }
      const mounted = this.#loaded.get(id);
      if (mounted !== undefined && mounted.level === desiredLevel) {
        continue;
      }
      if (this.#pool.has(`${id}@${desiredLevel}`)) {
        continue;
      }
      if ((this.#retryAfter.get(id) ?? 0) > now) {
        continue;
      }
      // 优先级 = 到视线中心距离的平方（池取数值最小者先执行）；
      // 降级（换更粗层释放显存）不产生视觉收益，恒排在载入/升级之后。
      const priority =
        distanceToChunkSq(focus, record) +
        (mounted !== undefined && desiredLevel > mounted.level ? DOWNGRADE_PRIORITY_PENALTY : 0);
      submissions.push({ record, level: desiredLevel, priority });
    }
    submissions.sort((a, b) => a.priority - b.priority);
    for (const submission of submissions) {
      void this.#submitLoad(submission.record, submission.level, submission.priority);
    }
    if (toLoad.length > 0 || submissions.length > 0) {
      // 提交即推送一次统计：让流式进度 UI 立刻看到 pending 份额。
      this.#emitProgress();
    }
  }

  /** 提交一个分块加载/换层任务（拉取对应层容器 → 解析 GLB → 楼层拆分挂载）。 */
  #submitLoad(record: ChunkRecord, level: number, priority: number): Promise<void> {
    const key = `${record.id}@${level}`;
    return this.#pool
      .submit(key, priority, async () => {
        if (this.#disposed || this.#abort.signal.aborted) {
          return;
        }
        const bytes = await this.#pkg.readChunkLod(record, level);
        if (this.#disposed || this.#abort.signal.aborted) {
          return;
        }
        const scene = await this.#parser.parseGlb(bytes);
        if (this.#disposed || this.#abort.signal.aborted) {
          disposeObject3D(scene);
          return;
        }
        const desired = this.#desired.get(record.id);
        const mounted = this.#loaded.get(record.id);
        if (desired === undefined) {
          // 规划期已离开应载集：直接丢弃解析结果。
          disposeObject3D(scene);
          return;
        }
        if (level !== desired && !(mounted === undefined && level > desired)) {
          // 过期任务：目标层已被更细层满足（mounted 更细）或目标层
          // 比当前需要的更细（相机已远离）——不挂载，避免无谓换层抖动。
          disposeObject3D(scene);
          return;
        }
        const parts: { object: Object3D; floor: number }[] = [];
        // 实例份额在挂载前统计：register 会把对象移出解析场景，
        // 挂载后再数 scene.children 会把单楼层分块（拆分原样返回原网格）
        // 全部漏记成 0，进度口径随之失真。
        for (const node of scene.children) {
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
        // 换层：先释放旧层对象的 GPU 资源（几何/材质/纹理/实例属性）。
        if (mounted !== undefined) {
          this.#releaseChunkObjects(mounted);
        }
        for (const part of parts) {
          this.#floorManager.register(part.object, part.floor);
        }
        this.#loaded.set(record.id, { id: record.id, level, parts });
        this.#failureStreaks.delete(record.id);
        this.#retryAfter.delete(record.id);
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
          `chunk ${record.id}@l${level} 加载失败（连续第 ${streak} 次，${Math.round(cooldownMs / 1000)}s 后重试）`,
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

/** 距离平方（优先级口径，避免开方）。 */
function distanceToChunkSq(center: Vec3, chunk: Pick<ChunkRecord, "center">): number {
  const dx = chunk.center.x - center.x;
  const dy = chunk.center.y - center.y;
  const dz = chunk.center.z - center.z;
  return dx * dx + dy * dy + dz * dz;
}

import { Group } from 'three';
import type { DmapLoader } from '@df3dmaptool/dmap';
import type { Vec3 } from '@/common/geometry';
import type { MapId } from '@/map';
import { getMapById } from '@/map';
import { DmapMapBundle, readSceneDoc, type SceneDoc } from './mapBundle';
import { connectFloorStore } from './floorBinding';
import { FloorManager } from './floorManager';
import { MapCameraControls } from './cameraControls';
import { MapSceneLayer } from './mapScene';
import { projectToScreen, type ScreenAnchor } from './poiProjector';
import type { ChunkProgressListener, ChunkStreamStats } from './mapScene';
import { SceneManager } from './SceneManager';

const CAMERA_LAYER_ID = 'camera-controls';

/** loadMap 可选项：数据层已打开容器时复用，避免同一数据包重复下载/解密。 */
export interface ViewerLoadOptions {
  /** 已通过完整性校验的容器加载器（作为首容器复用）。 */
  readonly loader?: DmapLoader;
  /** 容器基地址（清单声明多容器时按需加载相邻分片用；缺省用注册表地址）。 */
  readonly baseUrl?: string;
  /** chunk 流式加载进度回调。 */
  readonly onProgress?: ChunkProgressListener;
}

/**
 * 3D 视图门面：组合 SceneManager + 轨道相机 + 楼层系统 + 地图图层，
 * UI 层只需 loadMap/dispose 与少量转发接口。
 *
 * - loadMap 内部完成数据包拉取、解密、清单校验与首屏取景；
 * - 楼层 store 为唯一事实来源（connectFloorStore 单向驱动场景）；
 * - POI 锚点投影 projectPoi 供 HTML 标注层使用。
 */
export interface ViewerLoadState {
  readonly scene: SceneDoc;
  readonly stats: ChunkStreamStats | null;
}

export class MapViewer {
  readonly #manager: SceneManager;
  readonly #floorManager = new FloorManager({ dimInactive: true, dimOpacity: 0.18 });
  #controls: MapCameraControls | null = null;
  #mapLayer: MapSceneLayer | null = null;
  #bundle: DmapMapBundle | null = null;
  #unsubscribeFloor: (() => void) | null = null;
  #sceneDoc: SceneDoc | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.#manager = new SceneManager(canvas, { far: 6000 });
  }

  get sceneManager(): SceneManager {
    return this.#manager;
  }

  get controls(): MapCameraControls {
    if (this.#controls === null) {
      throw new Error('相机控制尚未就绪：先调用 loadMap');
    }
    return this.#controls;
  }

  get sceneDoc(): SceneDoc | null {
    return this.#sceneDoc;
  }

  get chunkStats(): ChunkStreamStats | null {
    return this.#mapLayer?.stats ?? null;
  }

  /**
   * 加载并显示一张地图；重复调用会先释放上一张图。
   * options.loader 传入数据层已打开的容器时不再重复拉取；
   * options.onProgress 在 chunk 增量加载时回调（首屏进度条用）。
   */
  async loadMap(mapId: MapId, options: ViewerLoadOptions = {}): Promise<SceneDoc> {
    const definition = getMapById(mapId);
    if (definition === undefined) {
      throw new RangeError(`未知地图: ${mapId}`);
    }
    this.unloadMap();

    const bundle =
      options.loader !== undefined
        ? DmapMapBundle.fromLoader(options.loader, options.baseUrl ?? definition.bundleUrl)
        : await DmapMapBundle.open(definition.bundleUrl);
    if (bundle.mapId !== mapId) {
      throw new RangeError(`数据包地图 (${bundle.mapId}) 与请求地图 (${mapId}) 不一致`);
    }
    const sceneDoc = await readSceneDoc(bundle);
    this.#bundle = bundle;
    this.#sceneDoc = sceneDoc;

    // 相机限制取自场景包围盒（首包解密完成后才有）
    const limits = {
      bounds: {
        min: { x: sceneDoc.bounds.min[0], y: sceneDoc.bounds.min[1], z: sceneDoc.bounds.min[2] },
        max: { x: sceneDoc.bounds.max[0], y: sceneDoc.bounds.max[1], z: sceneDoc.bounds.max[2] },
      },
    };
    this.#controls = new MapCameraControls(this.#manager.camera, this.#manager.canvas, limits);
    this.#controls.frameBounds(limits.bounds);

    // 相机控制先于地图图层每帧更新：阻尼/飞行/钳制后的相机状态
    // 再参与流式规划，避免视锥滞后一帧
    this.#manager.addLayer({
      id: CAMERA_LAYER_ID,
      root: new Group(),
      update: (deltaSeconds) => this.#controls?.update(deltaSeconds),
      dispose: () => {},
    });

    const layer = new MapSceneLayer(bundle, sceneDoc, this.#floorManager);
    layer.attachCamera(this.#manager.camera);
    layer.setFocusProvider(() => this.#controls?.target ?? this.#manager.camera.position);
    if (options.onProgress) {
      layer.onProgress(options.onProgress);
    }
    this.#manager.addLayer(layer);
    this.#mapLayer = layer;

    // 楼层 store 为唯一事实来源：先以场景元数据兜底，再接 store 单向驱动
    // （store 已应用过清单楼层时保持 store 值；未应用时落到场景值）
    this.#floorManager.setAvailableFloors(sceneDoc.floorValues, sceneDoc.floorValues[0]);
    this.#unsubscribeFloor?.();
    this.#unsubscribeFloor = connectFloorStore(this.#floorManager);
    return sceneDoc;
  }

  /** 释放当前地图（换图前自动调用）。 */
  unloadMap(): void {
    this.#unsubscribeFloor?.();
    this.#unsubscribeFloor = null;
    this.#manager.removeLayer(CAMERA_LAYER_ID);
    if (this.#mapLayer !== null) {
      this.#manager.removeLayer(this.#mapLayer.id);
      this.#mapLayer = null;
    }
    this.#controls?.dispose();
    this.#controls = null;
    this.#bundle?.dispose();
    this.#bundle = null;
    this.#sceneDoc = null;
    this.#floorManager.clear();
  }

  /** POI 世界坐标 → 画布 CSS 像素锚点（UI 标注层用）。 */
  projectPoi(world: Vec3): ScreenAnchor {
    const canvas = this.#manager.renderer.domElement;
    const camera = this.#manager.camera;
    camera.updateMatrixWorld();
    return projectToScreen(camera, world, canvas.clientWidth, canvas.clientHeight);
  }

  /** 相机缓动飞向目标点；地图未加载时返回 false（调用方可直接忽略）。 */
  flyTo(target: Vec3, distance?: number): boolean {
    if (this.#controls === null) {
      return false;
    }
    void this.#controls.flyTo(target, distance);
    return true;
  }

  dispose(): void {
    this.unloadMap();
    this.#manager.dispose();
  }
}

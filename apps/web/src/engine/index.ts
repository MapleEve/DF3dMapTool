export { DMAP_KEY_MATERIAL, DMAP_KEY_SEGMENTS, DMAP_KEY_TABLES, deriveDmapKey } from "./dmapKey";
export {
  AssetFetchError,
  containerFetcher,
  fetchContainerBytes,
  isDmapError,
  joinAssetUrl,
  openMapBundle,
  openMapPackage,
} from "./assets";
export type { EngineLayer, SceneManagerOptions } from "./SceneManager";
export { SceneManager } from "./SceneManager";
export { createPreviewLayer } from "./previewLayer";

// 数据包：分片两段式加载（索引容器 → 分块容器按名惰性拉取）
export { readSceneDoc } from "./mapBundle";
export type { SceneDoc, SceneFloorTrigger } from "./mapBundle";

// GLB 解析与资源释放
export { ChunkGltfParser, disposeObject3D, splitInstancedMeshByFloor } from "./gltf";
export type { FloorSplitPart } from "./gltf";

// 相机控制
export { MapCameraControls } from "./cameraControls";
export type { CameraLimits, CameraLimitsInput } from "./cameraControls";

// 楼层系统
export { deriveFloorBands, floorForY } from "./floorBands";
export type { FloorBand, FloorTrigger } from "./floorBands";
export { FloorManager } from "./floorManager";
export type { FloorManagerOptions } from "./floorManager";
export { connectFloorStore } from "./floorBinding";

// POI 投影
export { projectManyToScreen, projectToScreen } from "./poiProjector";
export type { ScreenAnchor } from "./poiProjector";

// 地图图层与视图门面
export { MapSceneLayer } from "./mapScene";
export type { ChunkProgressListener, ChunkStreamStats, MapSceneLayerOptions } from "./mapScene";
export { MapViewer } from "./viewer";
export type { MapViewerOptions, ViewerLoadOptions, ViewerLoadState } from "./viewer";

// 导航网格（NavMesh）寻路
export { NavMesh, NAVMESH_FORMAT, navMeshFromDoc } from "./navmesh/navmesh";
export type { NavPath, NavPoint, NavmeshDoc } from "./navmesh/navmesh";
export { NavPathLayer } from "./navmesh/navPathLayer";
export { NAVMESH_ENTRY, openNavMesh } from "./navmesh/loader";

// 路线系统（跟跑回放 + 3D 路线图层）
export {
  FOLLOW_BLEND_SECONDS,
  FOLLOW_EYE_HEIGHT,
  FOLLOW_LOOK_AHEAD_T,
  blendPose,
  clampFollowT,
  followHeadingAt,
  followIndexAt,
  followPositionAt,
  followPoseAt,
  ziplineDurationSeconds,
} from "./routeFollow";
export { RouteLayer } from "./routeLayer";

// F 键交互物件
export { DEFAULT_INTERACT_RADIUS, InteractorLayer } from "./interactorLayer";
export type { InteractorKind, NearbyInteractor } from "./interactorLayer";

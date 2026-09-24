export { DMAP_KEY_MATERIAL, DMAP_KEY_SEGMENTS, DMAP_KEY_TABLES, deriveDmapKey } from './dmapKey';
export { AssetFetchError, isDmapError, openMapBundle } from './assets';
export type { EngineLayer, SceneManagerOptions } from './SceneManager';
export { SceneManager } from './SceneManager';
export { createPreviewLayer } from './previewLayer';

// 数据包：清单驱动加载（fetch → 解密 → 容器内寻址）
export {
  DmapMapBundle,
  MapBundleFormatError,
  MAP_MANIFEST_ENTRY,
  MAP_MANIFEST_FORMAT,
  readSceneDoc,
} from './mapBundle';
export type {
  DmapChunkInfo,
  DmapMapManifest,
  DmapMapManifestEntries,
  SceneDoc,
  SceneFloorTrigger,
} from './mapBundle';

// GLB 解析与资源释放
export { ChunkGltfParser, disposeObject3D, splitInstancedMeshByFloor } from './gltf';
export type { FloorSplitPart } from './gltf';

// 相机控制
export { MapCameraControls } from './cameraControls';
export type { CameraLimits, CameraLimitsInput } from './cameraControls';

// 楼层系统
export { deriveFloorBands, floorForY } from './floorBands';
export type { FloorBand, FloorTrigger } from './floorBands';
export { FloorManager } from './floorManager';
export type { FloorManagerOptions } from './floorManager';
export { connectFloorStore } from './floorBinding';

// POI 投影
export { projectManyToScreen, projectToScreen } from './poiProjector';
export type { ScreenAnchor } from './poiProjector';

// 地图图层与视图门面
export { MapSceneLayer } from './mapScene';
export type { ChunkProgressListener, ChunkStreamStats, MapSceneLayerOptions } from './mapScene';
export { MapViewer } from './viewer';
export type { MapViewerOptions, ViewerLoadOptions, ViewerLoadState } from './viewer';

// 导航网格（NavMesh）寻路
export { NavMesh, NAVMESH_FORMAT, navMeshFromDoc } from './navmesh/navmesh';
export type { NavPath, NavPoint, NavmeshDoc } from './navmesh/navmesh';
export { NavPathLayer } from './navmesh/navPathLayer';
export { NAVMESH_ENTRY, openNavMesh } from './navmesh/loader';

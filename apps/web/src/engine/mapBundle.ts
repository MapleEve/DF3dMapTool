import type { DmapMapPackage } from "@df3dmaptool/dmap";

/**
 * 地图数据包的运行时视图（分片布局，dmap-map-manifest/3）：
 * 索引容器（清单 + POI/配置/图标/2D 标定）由 `DmapMapPackage` 两段式打开，
 * 分块容器按清单文件名惰性拉取（并行调度见 mapScene）。
 * 本模块只保留场景元数据（entries.scene 指向的 JSON）的类型与读取。
 */
export { MAP_MANIFEST_ENTRY, MAP_MANIFEST_FORMAT } from "@df3dmaptool/dmap";
export type { DmapChunkRef, DmapMapManifest, DmapMapManifestEntries } from "@df3dmaptool/dmap";

/** 场景元数据（entries.scene 指向的 JSON，坐标已统一到运行时世界系）。 */
export interface SceneFloorTrigger {
  readonly floor: number;
  readonly boundsCenter: readonly [number, number, number];
  readonly boundsExtent: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number, number];
}

export interface SceneDoc {
  readonly mapCode: string;
  readonly mapId: number;
  readonly floorValues: readonly number[];
  readonly bounds: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  };
  readonly floorTriggers: readonly SceneFloorTrigger[];
}

/** 场景元数据便捷读取（索引容器内，随 openIndex 即可读）。 */
export function readSceneDoc(pkg: DmapMapPackage): SceneDoc {
  const doc = pkg.readJson<SceneDoc>(pkg.manifest.entries.scene);
  if (doc.mapId !== pkg.manifest.map.mapId) {
    throw new RangeError(
      `场景元数据 mapId (${doc.mapId}) 与清单 (${pkg.manifest.map.mapId}) 不一致`,
    );
  }
  return doc;
}

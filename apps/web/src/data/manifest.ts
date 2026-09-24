import type { DmapLoader } from '@df3dmaptool/dmap';
import type { MapDefinition } from '@/map/types';

/**
 * 数据包内 manifest.json 的结构（dmap-map-manifest/1）。
 * `entries` 给出各类资产的包内路径；`chunkBounds` 描述 3D 分块的包围盒，
 * 供引擎按需加载与 UI 取景使用。
 */
export interface MapManifest {
  readonly format: string;
  readonly map: {
    readonly mapId: number;
    readonly code: string;
  };
  /** 楼层列表（升序）。 */
  readonly floors: readonly number[];
  readonly containers: readonly string[];
  readonly entries: {
    readonly scene: string;
    readonly poi: string;
    readonly map2d: string;
    readonly configs: readonly string[];
    readonly icons: string;
    readonly minimaps: string;
  };
  readonly counts: {
    readonly chunks: number;
    readonly instances: number;
    readonly vertices: number;
    readonly triangles: number;
    readonly geometries: number;
  };
  readonly chunkBounds: readonly MapChunkBounds[];
}

/** 一个 3D 分块的规模与包围盒（管线世界系）。 */
export interface MapChunkBounds {
  readonly id: string;
  readonly file: string;
  readonly container: number;
  readonly instances: number;
  readonly vertices: number;
  readonly triangles: number;
  readonly geometries: number;
  readonly bytes: number;
  readonly bytesCompressed: number;
  readonly boundsMin: readonly [number, number, number];
  readonly boundsMax: readonly [number, number, number];
}

/** 加载完成的地图数据包：定义 + 清单 + 已通过完整性校验的加载器。 */
export interface MapBundle {
  readonly definition: MapDefinition;
  readonly manifest: MapManifest;
  readonly loader: DmapLoader;
}

/** manifest 在包内的固定条目名。 */
export const MANIFEST_ENTRY = 'manifest.json';
/** manifest 结构标识（format 字段）。 */
export const MANIFEST_FORMAT = 'dmap-map-manifest/1';

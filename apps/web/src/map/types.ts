import type { Vec3 } from "@/common/geometry";

/** 可切换地图的数字 ID（与游戏内地图编号一致）。 */
export type MapId = 101 | 102 | 104 | 105 | 106 | 203;

/** 地图资产代号，同时是数据包目录名（/assets/<code>/）。 */
export type MapCode = "az3" | "brakkesh" | "damiris" | "forrest" | "spacecenter" | "tideprison";

/** 地图显示名的 i18n 键（对应 resources.translation.maps.*）。 */
export type MapNameKey = `maps.${MapCode}`;

/** 一张地图的静态定义；运行时数据（楼层、POI、摆放）以数据包索引为准。 */
export interface MapDefinition {
  readonly id: MapId;
  readonly code: MapCode;
  /** i18n 显示名键。 */
  readonly nameKey: MapNameKey;
  /** 已标定楼层列表（来自 2D 楼层配置盘点）；运行时加载后以数据包 manifest 为准。 */
  readonly knownFloors: readonly number[];
  /** 进入地图时的默认楼层。 */
  readonly defaultFloor: number;
  /** 数据包索引容器地址（分块/导航容器按清单相对路径派生）。 */
  readonly bundleUrl: string;
  /** 已标定的摆放规模（标定信息，供状态栏展示）。 */
  readonly knownPlacementCount?: number;
}

/** 3D 场景中一个静态摆放对象的运行时形态。 */
export interface PlacementInstance {
  readonly id: string;
  /** 数据包内的预制体键（去重后的几何库键名）。 */
  readonly prefabKey: string;
  readonly position: Vec3;
  /** 已镜像后的旋转四元数（见 coordinate.ts）。 */
  readonly rotation: { x: number; y: number; z: number; w: number };
  readonly floor: number;
}

import type { Vec3 } from '@/common/geometry';
import { pipelinePixelToWorld } from './project';
import type { BigmapCalibration, PixelPoint, WorldXZ } from './types';

/**
 * 2D → 3D 传送规划（对齐原 2DBigMap 传送交互：右键标记 / POI 详情
 * txtBtnTeleport → TryTeleport，2D 点位反算世界坐标直接驱动 3D 落点）。
 *
 * 传送是 UI 动作驱动（按钮触发），不做自动传送；跨层传送时同步 3D 楼层，
 * 楼层以数据包 manifest 楼层表校验，避免把非法楼层写进楼层 store。
 */

/** 传送计划：3D 相机落点与传送后应处的楼层。 */
export interface TeleportPlan {
  readonly position: Vec3;
  readonly floor: number;
  /** 本次传送是否切换了 3D 楼层（跨层传送）。 */
  readonly floorChanged: boolean;
}

export interface TeleportPlanInput {
  /** 2D 落点（管线世界系，通常来自 pipelinePixelToWorld 或 POI 世界坐标）。 */
  readonly world: WorldXZ;
  /** 落点高度（POI 传送携带自身高度；标记传送缺省为 0，由相机钳制兜底）。 */
  readonly worldY?: number;
  /** 目标楼层；null 表示保持当前楼层（如全图概览上的落点）。 */
  readonly targetFloor: number | null;
  readonly currentFloor: number;
  /** 数据包楼层表（manifest.floors），用于目标楼层合法性校验。 */
  readonly floors: readonly number[];
}

/** POI 传送的楼层归并：POI 自身楼层优先（楼层 0 = 全楼层，不限定），其次大地图当前页签。 */
export function resolveTeleportFloor(poiFloor: number, bigmapFloor: number | null): number | null {
  if (poiFloor !== 0) {
    return poiFloor;
  }
  return bigmapFloor;
}

/** 依据输入生成传送计划（纯函数，供组件与单测复用）。 */
export function planTeleport(input: TeleportPlanInput): TeleportPlan {
  const { world, worldY, targetFloor, currentFloor, floors } = input;
  const floor =
    targetFloor !== null && floors.includes(targetFloor) ? targetFloor : currentFloor;
  return {
    position: { x: world.x, y: worldY ?? 0, z: world.z },
    floor,
    floorChanged: floor !== currentFloor,
  };
}

/** 大地图点击像素 → 管线世界系落点（传送链路的 2D 侧入口）。 */
export function markerPixelToWorld(
  pixel: PixelPoint,
  calibration: BigmapCalibration,
): WorldXZ {
  return pipelinePixelToWorld(pixel, calibration);
}

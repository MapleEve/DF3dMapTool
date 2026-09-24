import { pipelineWorldToUv } from './project';
import type { BigmapCalibration, WorldXZ } from './types';

/**
 * HUD 小地图取景（对齐 WGMiniMap GetMapImageRect 语义）：
 * 与 2D 大地图共用同一张楼层俯视贴图，按玩家/相机世界坐标裁出一方
 * 固定世界跨度的方形视窗，边缘越界时贴边平移（视窗不越出底图）。
 */

/** 小地图视窗的世界跨度 = 楼层世界包围盒较长边的该比例。 */
export const MINIMAP_SPAN_FRACTION = 0.38;

/** 一方裁剪视窗（归一化 UV，u1/v1 > u0/v0）。 */
export interface MinimapWindow {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

/** 楼层标定下的方形视窗跨度（世界系单位）。 */
export function minimapWorldSpan(calibration: BigmapCalibration): number {
  const spanX = calibration.worldMaxX - calibration.worldMinX;
  const spanZ = calibration.worldMaxZ - calibration.worldMinZ;
  return Math.max(spanX, spanZ) * MINIMAP_SPAN_FRACTION;
}

/**
 * 以 center 为中心裁出方形视窗；中心靠近边缘时整体贴边，
 * 视窗大于底图时收缩为整图。
 */
export function minimapWindowUv(
  center: WorldXZ,
  calibration: BigmapCalibration,
  worldSpan: number,
): MinimapWindow {
  const spanX = calibration.worldMaxX - calibration.worldMinX;
  const spanZ = calibration.worldMaxZ - calibration.worldMinZ;
  const centerUv = pipelineWorldToUv(center, calibration);
  const halfU = spanX === 0 ? 0.5 : Math.min(worldSpan / 2 / spanX, 0.5);
  const halfV = spanZ === 0 ? 0.5 : Math.min(worldSpan / 2 / spanZ, 0.5);
  const u0 = Math.min(Math.max(centerUv.u - halfU, 0), 1 - halfU * 2);
  const v0 = Math.min(Math.max(centerUv.v - halfV, 0), 1 - halfV * 2);
  return { u0, v0, u1: u0 + halfU * 2, v1: v0 + halfV * 2 };
}

/** 世界坐标 → 小地图画布坐标（视窗内线性映射）。 */
export function worldToMinimapCanvas(
  world: WorldXZ,
  calibration: BigmapCalibration,
  window: MinimapWindow,
  sizePx: number,
): { x: number; y: number } {
  const uv = pipelineWorldToUv(world, calibration);
  const spanU = window.u1 - window.u0;
  const spanV = window.v1 - window.v0;
  return {
    x: spanU === 0 ? sizePx / 2 : ((uv.u - window.u0) / spanU) * sizePx,
    y: spanV === 0 ? sizePx / 2 : ((uv.v - window.v0) / spanV) * sizePx,
  };
}

/**
 * HUD 世界坐标刻度文本（游戏内置 ×100 刻度习惯）。
 * 管线世界系 z 已镜像，等价于源系的 (worldX×100, −worldZ×100)。
 */
export function pipelineWorldDisplayCoords(world: WorldXZ): { x: number; y: number } {
  return { x: world.x * 100, y: world.z * 100 };
}

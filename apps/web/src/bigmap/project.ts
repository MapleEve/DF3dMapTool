import type { BigmapCalibration, PixelPoint, UvPoint, WorldXZ } from './types';

/**
 * 世界坐标 → 俯视底图像素的线性投影（2D 线性映射，无瓦片、无第三方地图库）。
 *
 * 本函数为「源世界系」口径（烘焙图与标定表的原始坐标系）：
 *
 *   u = (worldX − worldMinX) / (worldMaxX − worldMinX)
 *   v = 1 − (worldZ − worldMinZ) / (worldMaxZ − worldMinZ)   // 原点在左上，Z 轴向下翻转
 *   px = u × imageWidthPx,  py = v × imageHeightPx
 *
 * 应用运行时统一使用「管线世界系」（源数据已做 Z 镜像：z → −z）。
 * 代入镜像后上式化为等价的 py 随管线 +z 增长形式（无翻转），见 pipelineWorldToPixel。
 *
 * 底图分辨率（1024/2048）只是同一虚拟网格的缩放采样，用归一化 UV 即与分辨率无关。
 * 反向映射（pipelinePixelToWorld）用于缩放锚点、2D 标记落点换算与「2D 标记 → 3D
 * 定位传送」（3D 侧统一走 flyTo 缓动飞行）。
 */

export function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export function worldToUv(world: WorldXZ, calibration: BigmapCalibration): UvPoint {
  const spanX = calibration.worldMaxX - calibration.worldMinX;
  const spanZ = calibration.worldMaxZ - calibration.worldMinZ;
  const u = spanX === 0 ? 0 : (world.x - calibration.worldMinX) / spanX;
  const v = spanZ === 0 ? 0 : 1 - (world.z - calibration.worldMinZ) / spanZ;
  return { u, v };
}

export function uvToPixel(uv: UvPoint, calibration: BigmapCalibration): PixelPoint {
  return {
    x: uv.u * calibration.imageWidthPx,
    y: uv.v * calibration.imageHeightPx,
  };
}

export function worldToPixel(world: WorldXZ, calibration: BigmapCalibration): PixelPoint {
  return uvToPixel(worldToUv(world, calibration), calibration);
}

export function pixelToWorld(pixel: PixelPoint, calibration: BigmapCalibration): WorldXZ {
  const spanX = calibration.worldMaxX - calibration.worldMinX;
  const spanZ = calibration.worldMaxZ - calibration.worldMinZ;
  const u = calibration.imageWidthPx === 0 ? 0 : pixel.x / calibration.imageWidthPx;
  const v = calibration.imageHeightPx === 0 ? 0 : pixel.y / calibration.imageHeightPx;
  return {
    x: calibration.worldMinX + u * spanX,
    z: calibration.worldMinZ + (1 - v) * spanZ,
  };
}

/**
 * 区域标注的显示坐标：世界坐标 × 100、Z 取负（游戏内置小地图刻度习惯，
 * 用于区域名/选择列表的展示数值，与底图像素投影无关）。
 */
export function toRegionDisplayCoords(world: WorldXZ): PixelPoint {
  return { x: world.x * 100, y: -world.z * 100 };
}

/** 判断世界坐标是否落在俯视图包围盒内（越界输入拒绝投影，避免飘出底图）。 */
export function isInsideCalibration(world: WorldXZ, calibration: BigmapCalibration): boolean {
  return (
    world.x >= calibration.worldMinX &&
    world.x <= calibration.worldMaxX &&
    world.z >= calibration.worldMinZ &&
    world.z <= calibration.worldMaxZ
  );
}

/** 投影并夹取到底图范围内。 */
export function worldToPixelClamped(world: WorldXZ, calibration: BigmapCalibration): PixelPoint {
  const uv = worldToUv(world, calibration);
  return uvToPixel({ u: clamp01(uv.u), v: clamp01(uv.v) }, calibration);
}

/**
 * 管线世界系（右手、Y 上、源数据已 Z 镜像）下的投影：
 *
 *   u = (worldX − worldMinX) / spanX
 *   pv = (worldZ − worldMinZ) / spanZ     // py 随管线 +z 增长（无翻转）
 *   px = u × imageWidthPx,  py = pv × imageHeightPx
 *
 * 与上方「源世界系」公式数学等价：把 z → −z 与标定盒一起代入即得本式，
 * 数据包内 POI 坐标与 2D 楼层标定均为该口径，直接使用本函数。
 */
export function pipelineWorldToUv(world: WorldXZ, calibration: BigmapCalibration): UvPoint {
  const spanX = calibration.worldMaxX - calibration.worldMinX;
  const spanZ = calibration.worldMaxZ - calibration.worldMinZ;
  const u = spanX === 0 ? 0 : (world.x - calibration.worldMinX) / spanX;
  const v = spanZ === 0 ? 0 : (world.z - calibration.worldMinZ) / spanZ;
  return { u, v };
}

export function pipelineWorldToPixel(world: WorldXZ, calibration: BigmapCalibration): PixelPoint {
  return uvToPixel(pipelineWorldToUv(world, calibration), calibration);
}

export function pipelinePixelToWorld(pixel: PixelPoint, calibration: BigmapCalibration): WorldXZ {
  const spanX = calibration.worldMaxX - calibration.worldMinX;
  const spanZ = calibration.worldMaxZ - calibration.worldMinZ;
  const u = calibration.imageWidthPx === 0 ? 0 : pixel.x / calibration.imageWidthPx;
  const v = calibration.imageHeightPx === 0 ? 0 : pixel.y / calibration.imageHeightPx;
  return {
    x: calibration.worldMinX + u * spanX,
    z: calibration.worldMinZ + v * spanZ,
  };
}

/** 管线世界系下的投影并夹取到底图范围内。 */
export function pipelineWorldToPixelClamped(
  world: WorldXZ,
  calibration: BigmapCalibration,
): PixelPoint {
  const uv = pipelineWorldToUv(world, calibration);
  return uvToPixel({ u: clamp01(uv.u), v: clamp01(uv.v) }, calibration);
}

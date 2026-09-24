import { Vector3, type Camera } from 'three';
import type { Vec3 } from '@/common/geometry';

/**
 * POI 世界坐标 → 屏幕像素投影接口（供 UI 层锚定 HTML 标记）。
 *
 * 坐标口径与数据包一致（Z 镜像后的运行时世界系）；返回 CSS 像素，
 * 原点为画布左上角。相机朝向后方的点标记 visible=false，UI 层应隐藏
 * 对应锚点；边界内判定可按需放宽（越界锚点交给 UI 决定是否裁剪）。
 */
export interface ScreenAnchor {
  /** CSS 像素 X（画布左上角原点）。 */
  readonly x: number;
  /** CSS 像素 Y（画布左上角原点）。 */
  readonly y: number;
  /** 是否应显示（在相机前方且未越出视口）。 */
  readonly visible: boolean;
  /** 到相机的距离（米），供 UI 做近大远小/遮挡优先级。 */
  readonly distance: number;
}

const point = new Vector3();
const viewPoint = new Vector3();

export function projectToScreen(
  camera: Camera,
  world: Vec3,
  viewportWidth: number,
  viewportHeight: number,
): ScreenAnchor {
  viewPoint.set(world.x, world.y, world.z).applyMatrix4(camera.matrixWorldInverse);
  const distance = -viewPoint.z;
  // 相机后方：投影结果无意义，直接判定不可见
  if (viewPoint.z >= 0) {
    return { x: 0, y: 0, visible: false, distance };
  }
  point.set(world.x, world.y, world.z).project(camera);
  return {
    x: (point.x * 0.5 + 0.5) * viewportWidth,
    y: (-point.y * 0.5 + 0.5) * viewportHeight,
    visible:
      point.x >= -1 && point.x <= 1 && point.y >= -1 && point.y <= 1 && distance > 0,
    distance,
  };
}

/** 批量投影；复用临时向量避免逐点分配。 */
export function projectManyToScreen(
  camera: Camera,
  worlds: readonly Vec3[],
  viewportWidth: number,
  viewportHeight: number,
): ScreenAnchor[] {
  return worlds.map((world) => projectToScreen(camera, world, viewportWidth, viewportHeight));
}

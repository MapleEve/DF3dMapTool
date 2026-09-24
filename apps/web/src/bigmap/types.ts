/** 2D 俯视覆盖层的标定与绘制类型。 */

/** 一张俯视底图的标定：世界包围盒 + 底图像素尺寸（每图每楼层一份，随数据包下发）。 */
export interface BigmapCalibration {
  readonly worldMinX: number;
  readonly worldMaxX: number;
  readonly worldMinZ: number;
  readonly worldMaxZ: number;
  readonly imageWidthPx: number;
  readonly imageHeightPx: number;
}

/** 0..1 归一化贴图坐标。 */
export interface UvPoint {
  readonly u: number;
  readonly v: number;
}

/** 底图像素坐标（原点在左上）。 */
export interface PixelPoint {
  readonly x: number;
  readonly y: number;
}

/** 世界 XZ 平面坐标。 */
export interface WorldXZ {
  readonly x: number;
  readonly z: number;
}

/** 俯视覆盖层上一个可绘制的标记。 */
export interface BigmapMarker {
  readonly id: string;
  readonly pixel: PixelPoint;
  readonly label?: string;
  readonly color?: string;
  /** 是否被 2D 隐藏配置过滤。 */
  readonly hidden?: boolean;
}

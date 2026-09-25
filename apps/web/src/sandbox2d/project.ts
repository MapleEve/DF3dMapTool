/**
 * 2D 沙盘站点像素投影（纯函数）。
 *
 * 坐标口径全部实测锚定（数据 + 渲染双验证，两套轴约定互为转置，如实复刻不修正）：
 *
 * 站点 latLng：lat = A/8 − 512，lng = B/8（Leaflet CRS.Simple；px = lng·2^z，py = −lat·2^z）
 * - 区域标注：M(x, y) → lat 由 x、lng 由 y 推导（chunk 实证）
 *     全分辨率（4096²、原点左上、x 右 y 下）：sx = y，sy = 4096 − x
 *     验证：Administrative Area(2720,2220)→(605,308) 等 4 锚点 + pan(50,−36) 误差 0px
 * - POI 标记：M(position[1], position[0]) → lat 由 y、lng 由 x 推导（轴转置，chunk 实证）
 *     全分辨率：sx = x，sy = 4096 − y
 *     验证：damiris bird-nest 20/20 标记点位误差 ≤0.5px（整数舍入）
 * - 右键坐标弹窗：显示 x = lng·8（水平），y = (lat+512)·8（自下而上）→ "x;y"
 *     即全分辨率下 popup = round(sx);round(4096 − sy)（chunk 逆变换逐字实证）
 * - 楼层叠加（chunk 原式 i=512/4096; n=xAnchor·i; o=yAnchor·i; s=width·i;
 *   bounds=[[o+h·i−512,n],[o−512,n+s]]，经 latLng→全分辨率换算）：
 *     sx ∈ [xAnchor, xAnchor+width]，sy ∈ [4096−yAnchor−height, 4096−yAnchor]
 *
 * 缩放：zoom 1–6 整数档（滚轮累积 40px/档）；原生瓦片 z1–z3，z4–6 取 z3 放大 2^(z−3) 倍。
 * 本模块全分辨率（4096²）为基准空间；任一 zoom z 的屏幕像素 = 全分辨率 × 2^(z−3)。
 */

/** 站点数据空间边长（正方形）。 */
export const WORLD_SIZE = 4096;
/** 原生瓦片金字塔层数边界（z4–6 为 z3 上采样）。 */
export const NATIVE_MIN_ZOOM = 1;
export const NATIVE_MAX_ZOOM = 3;
/** 交互 zoom 档边界。 */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;
/** 单张瓦片边长（屏幕像素，任意 zoom 下）。 */
export const TILE_SIZE = 512;

/** 全分辨率平面坐标（原点左上、x 向右、y 向下、值域 [0,4096)）。 */
export interface FullResPoint {
  readonly sx: number;
  readonly sy: number;
}

/** 全分辨率矩形（x0/y0 为左上角）。 */
export interface FullResRect {
  readonly x0: number;
  readonly y0: number;
  readonly w: number;
  readonly h: number;
}

/** zoom z 下全分辨率 → 屏幕 px 的缩放系数（z=3 恒等）。 */
export function zoomScale(zoom: number): number {
  return 2 ** (zoom - NATIVE_MAX_ZOOM);
}

/** 区域标注（站点轴 x=纵向、y=横向）→ 全分辨率。 */
export function regionToFullRes(x: number, y: number): FullResPoint {
  return { sx: y, sy: WORLD_SIZE - x };
}

/** 全分辨率 → 区域标注站点轴（逆变换）。 */
export function fullResToRegion(point: FullResPoint): { x: number; y: number } {
  return { x: WORLD_SIZE - point.sy, y: point.sx };
}

/** POI（站点轴 x=横向、y=纵向自下而上）→ 全分辨率。 */
export function pointToFullRes(x: number, y: number): FullResPoint {
  return { sx: x, sy: WORLD_SIZE - y };
}

/** 全分辨率 → POI 站点轴（逆变换）。 */
export function fullResToPoint(point: FullResPoint): { x: number; y: number } {
  return { x: point.sx, y: WORLD_SIZE - point.sy };
}

/** POI 站点轴 → 区域站点轴（两套轴约定互转：用于跨视图仿射与区域级定位）。 */
export function pointAxesToRegionAxes(x: number, y: number): { x: number; y: number } {
  const full = pointToFullRes(x, y);
  return fullResToRegion(full);
}

/** 楼层叠加锚点/宽高 → 全分辨率矩形（宽高即源图像素尺寸，1:1 放置）。 */
export function overlayToFullRes(overlay: {
  xAnchor: number;
  yAnchor: number;
  width: number;
  height: number;
}): FullResRect {
  return {
    x0: overlay.xAnchor,
    y0: WORLD_SIZE - overlay.yAnchor - overlay.height,
    w: overlay.width,
    h: overlay.height,
  };
}

/** 右键坐标弹窗取值：全分辨率 → "x;y" 的两个数值（Math.round 整数，逆变换实测口径）。 */
export function fullResToPopup(point: FullResPoint): { x: number; y: number } {
  return { x: Math.round(point.sx), y: Math.round(WORLD_SIZE - point.sy) };
}

/** 弹窗数值 → 全分辨率（逆）。 */
export function popupToFullRes(x: number, y: number): FullResPoint {
  return { sx: x, sy: WORLD_SIZE - y };
}

/** 全分辨率 → zoom z 屏幕像素（不含平移）。 */
export function fullResToZoomPx(point: FullResPoint, zoom: number): { x: number; y: number } {
  const s = zoomScale(zoom);
  return { x: point.sx * s, y: point.sy * s };
}

/** zoom z 屏幕像素 → 全分辨率。 */
export function zoomPxToFullRes(x: number, y: number, zoom: number): FullResPoint {
  const s = zoomScale(zoom);
  return { sx: x / s, sy: y / s };
}

/** 单轴平移夹取：世界放得下 → 居中；否则夹到 [viewport−world, 0]。 */
function clampPanAxis(offset: number, viewport: number, world: number): number {
  if (world <= viewport) {
    // 放得下：居中（Leaflet maxBounds 全包含时的行为）
    return (viewport - world) / 2;
  }
  const min = viewport - world;
  const max = 0;
  return Math.min(max, Math.max(min, offset));
}

/**
 * 视口平移夹取（maxBounds 手感）：世界（zoom px 尺寸 worldPx）在视口 viewportPx 内
 * 可完全放入时居中；否则夹取到边界。返回平移量（屏幕 px）。
 */
export function clampPan(
  offsetX: number,
  offsetY: number,
  viewportW: number,
  viewportH: number,
  worldW: number,
  worldH: number,
): { x: number; y: number } {
  return {
    x: clampPanAxis(offsetX, viewportW, worldW),
    y: clampPanAxis(offsetY, viewportH, worldH),
  };
}

/**
 * 越界阻尼（maxBoundsViscosity=0.5 手感）：把目标平移量往夹取值方向收敛一半。
 * 拖拽期间持续施加；释放后由回弹动画归位。
 */
export function dampPan(
  offset: { x: number; y: number },
  clamped: { x: number; y: number },
  viscosity: number,
): { x: number; y: number } {
  return {
    x: clamped.x + (offset.x - clamped.x) * (1 - viscosity),
    y: clamped.y + (offset.y - clamped.y) * (1 - viscosity),
  };
}

/** flyTo 位移动效缓动（duration 0.5s / easeLinearity 0.25 手感的近似：easeInOutCubic）。 */
export function flyEase(t: number): number {
  if (t <= 0) {
    return 0;
  }
  if (t >= 1) {
    return 1;
  }
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

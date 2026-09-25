/**
 * 全页 2D 沙盘视图（Batch3）。
 *
 * 模块清单（设计 §1.1）：
 * - types.ts            容器数据类型（dmap-sandbox2d-manifest/1）
 * - project.ts          站点像素投影（POI/区域两套轴约定，实测锚定）+ 缩放/夹取/缓动
 * - tileGrid.ts         视口 → 瓦片清单（z4–6 上采样；az3 楼层模板）
 * - filter.ts           过滤语义逐字还原（z=null 楼层隐藏等上游行为，勿修正）
 * - loadSandbox2d.ts    容器拉取/校验/缓存（惰性；独立于 dmap-map-manifest/3）
 * - useTileImages.ts    位图 LRU + 并发池 6 + 重试 1
 * - sandboxStore.ts     2D 专属状态（过滤/选中/弹窗；换图复位；勾选监听供耦合）
 * - TileMapCanvas.tsx   瓦片画布（平移/缩放/命中/悬停/flyTo/右键上报）
 * - SandboxSidebar.tsx  五控件 + 分类勾选清单
 * - SandboxDetailPanel.tsx  点位详情（含 3D 近似定位）
 * - SandboxCoordinatePopup.tsx  右键坐标弹窗
 * - Sandbox2dView.tsx   全页布局 + 双视图耦合接线
 */

export { Sandbox2dView } from "./Sandbox2dView";
export type { TileMapController } from "./TileMapCanvas";
export {
  loadSandbox2d,
  resetSandbox2dCache,
  sandboxLoadErrorCode,
  Sandbox2dCorruptError,
  Sandbox2dUnavailableError,
  type Sandbox2dPackage,
} from "./loadSandbox2d";
export type {
  Sandbox2dData,
  SandboxLegendItem,
  SandboxPoint,
  SandboxRegion,
  SandboxGroupId,
} from "./types";

/**
 * 2D 沙盘数据包（sandbox2d.dmap，格式 dmap-sandbox2d-manifest/1）的运行时类型。
 *
 * 坐标口径（全部实测锚定，见 project.ts 头注释）：
 * - 站点数据空间 4096²；POI 与区域标注使用**两套互为转置的轴约定**（实测锚定，如实复刻）；
 * - 楼层为站点 0 基（floorMap 提供站点→应用域显式映射）；
 * - 名称语言字段族（nameEn/nameZhTw/nameZh/titleEn/titleZh/descEn）的解析链见 i18n/sandboxNames。
 */

/** 站点 4096² 空间 → 3D 管线世界系的 2×3 仿射（区域级近似定位，残差随包记录）。 */
export interface SandboxAffine {
  readonly M: readonly [readonly [number, number], readonly [number, number]];
  readonly t: readonly [number, number];
  /** 拟合锚点数（运行时不消费，标定信息）。 */
  readonly n?: number;
  readonly errMean?: number;
  readonly errMax?: number;
}

export interface SandboxLinkAffine {
  /** 站点区域轴 (x=纵向, y=横向) → 世界 (X, Z)。 */
  readonly siteToWorld: SandboxAffine;
  /** 世界 (X, Z) → 站点区域轴。 */
  readonly worldToSite: SandboxAffine;
}

export interface SandboxMeta {
  readonly mapCode: string;
  readonly mapId: number;
  readonly worldSize: number;
  readonly iconSize: number;
  /**
   * 瓦片路径模板（容器内相对路径）：
   * - 四图 `tiles/{z}/{y}/{x}.webp`（{x}=列、{y}=行）
   * - az3 `tiles/{floor}/{z}/{x}/{y}.webp`（floor ∈ base|1f|2f|3f，整层换图）
   */
  readonly tileTemplate: string;
  /** 站点楼层值域（0 基）。 */
  readonly siteFloors: readonly number[];
  /** 站点楼层 → 应用楼层显式映射（防 off-by-one；运行时反查优先）。 */
  readonly floorMap: readonly { readonly site: number; readonly app: number }[];
  /** 难度选项（上游逐图：damiris/forrest=[easy,normal]、spacecenter/brakkesh=[normal]、az3=[]）。 */
  readonly difficultyOptions: readonly string[];
  readonly linkAffine: SandboxLinkAffine;
}

/** 区域名标注（站点轴：x=纵向、y=横向）。 */
export interface SandboxRegion {
  readonly id: string;
  readonly nameEn: string | null;
  readonly nameZhTw: string | null;
  /** nameZhTw 繁→简派生（管线确定性转换）。 */
  readonly nameZh: string | null;
  readonly x: number;
  readonly y: number;
}

/** POI 点位（POI 轴：x=横向、y=纵向自下而上，与区域轴转置——实测锚定）。 */
export interface SandboxPoint {
  readonly id: number;
  /** 分类 id（如 bird-nest）；与 legend.id 对应。 */
  readonly item: string;
  readonly x: number;
  readonly y: number;
  /** 站点楼层（null = 全楼层）。 */
  readonly floor: number | null;
  readonly difficulties: readonly string[] | null;
  /** 具名位名称（75 条；搜索下拉与 hover 标签依赖）。 */
  readonly nameEn: string | null;
  /** 物品名（标题）。 */
  readonly titleEn: string | null;
  /** 物品名（简体中文，源载荷 cn_name，2047/2047 全覆盖）。 */
  readonly titleZh: string | null;
  readonly descEn: string | null;
  /** 物品图（media/ 内 hash 文件名；数据无引用或上游对象已失效为 null 占位）。 */
  readonly media: string | null;
  /** 用户截图（同 media 池）。 */
  readonly shot: string | null;
  /** 最后更新日期（YYYY-MM-DD；详情面板消费）。 */
  readonly updatedAt: string | null;
  readonly randomSpawn: boolean;
  readonly validated: boolean;
  readonly bgColor: string | null;
}

/** 图例分类（57 类；站点三 locale 图例均显英文，如实对齐）。 */
export interface SandboxLegendItem {
  readonly id: string;
  readonly group: SandboxGroupId;
  readonly nameEn: string;
  readonly count: number;
  readonly iconFile: string | null;
  readonly bgColor: string | null;
}

/** 图例分组 slug（与 viewCoupling.SANDBOX_GROUP_IDS 对齐）。 */
export type SandboxGroupId = "event" | "extraction" | "loot" | "red-loot" | "spawn";

/** 楼层叠加层（四图模式；az3 无叠加，整层换瓦片）。 */
export interface SandboxOverlay {
  readonly file: string;
  readonly floor: number;
  readonly width: number;
  readonly height: number;
  readonly xAnchor: number;
  readonly yAnchor: number;
}

/** 清洗后的 sandbox2d 数据正文。 */
export interface Sandbox2dData {
  readonly meta: SandboxMeta;
  readonly regions: readonly SandboxRegion[];
  readonly points: readonly SandboxPoint[];
  readonly legend: readonly SandboxLegendItem[];
  readonly overlays: readonly SandboxOverlay[];
}

/** 容器 manifest（独立格式串，不动 dmap-map-manifest/3）。 */
export interface Sandbox2dManifest {
  readonly format: "dmap-sandbox2d-manifest/1";
  readonly mapId: number;
  readonly code: string;
  readonly entries: {
    readonly data: string;
    readonly icons: string;
    readonly media: string;
  };
  readonly meta: {
    readonly tileTemplate: string;
    readonly siteFloors: readonly number[];
    readonly floorMap: readonly { readonly site: number; readonly app: number }[];
    readonly difficultyOptions: readonly string[];
  };
  readonly counts: {
    readonly points: number;
    readonly regions: number;
    readonly legend: number;
    readonly tiles: number;
    readonly overlays: number;
    readonly named: number;
  };
}

/** 图例图标索引（业务键 → 文件与尺寸）。 */
export interface SandboxIconIndex {
  readonly [itemId: string]: {
    readonly file: string;
    readonly width: number;
    readonly height: number;
  };
}

/** 媒体尺寸索引（hash 文件名 → 尺寸；无来源键）。 */
export interface SandboxMediaIndex {
  readonly [file: string]: { readonly width: number; readonly height: number };
}

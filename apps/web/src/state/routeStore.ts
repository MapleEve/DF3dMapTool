import { create } from "zustand";
import {
  decodeRoutePoints,
  routeLoadErrorCode,
  loadRoutes,
  routePointAt,
  type RouteDefinition,
  type RouteLoadErrorCode,
  type RouteMarker,
  type RoutesDoc,
} from "@/data/routes";
import type { MapCode } from "@/map/types";
import type { Vec3 } from "@/common/geometry";

/**
 * 路线系统状态：Q 面板（列表/详情）+ 热门路线跟跑 + 自录（本地保存/导出/导入）。
 *
 * - 热门路线来自数据包（df3d-routes/1）；自录路线存 localStorage（df3dmaptool:customRoutes），
 *   与热门路线同列表呈现（自录在前，与上游“我的路线”并列语义一致）；
 * - 跟跑执行在视口（相机沿点位按 durationSeconds 回放），store 只持有请求与进度；
 * - 导出/导入为 df3d-route-user/1 JSON（单条路线），与自录存储同构。
 */

export const CUSTOM_ROUTES_STORAGE_KEY = "df3dmaptool:customRoutes";
export const CUSTOM_ROUTE_EXPORT_FORMAT = "df3d-route-user/1";
/** 自录采样间隔（毫秒）。 */
export const RECORD_SAMPLE_INTERVAL_MS = 200;

/** 面板视图：路线列表 / 路线详情。 */
export type RoutePanelMode = "list" | "detail";

/** 运行时路线（点位已解码为 float32 序列）。 */
export interface RuntimeRoute {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string | null;
  readonly hotScore: number;
  readonly durationSeconds: number;
  readonly lengthMeters: number;
  readonly pointCount: number;
  readonly points: Float32Array;
  readonly markers: readonly RouteMarker[];
  readonly custom: boolean;
  /** 自录路线的描述（热门路线无此字段）。 */
  readonly description?: string;
}

/** 自录路线的持久化形态。 */
export interface StoredCustomRoute {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly durationSeconds: number;
  readonly lengthMeters: number;
  readonly recordedAt: string;
  readonly points: readonly { readonly x: number; readonly y: number; readonly z: number }[];
  readonly markers: readonly { readonly name: string; readonly worldPos: Vec3 }[];
}

/** 自录会话的进行时数据（面板实时读数）。 */
export interface RecordSession {
  readonly startedAt: number;
  /** 采样点（管线世界系）。 */
  readonly points: readonly Vec3[];
  /** 标注点（录制中添加）。 */
  readonly markers: readonly { name: string; worldPos: Vec3 }[];
}

export type RoutesStatus = "idle" | "loading" | "ready" | "unavailable";

/** 折线总长（米）。 */
export function polylineLength(points: readonly Vec3[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    total += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return total;
}

function runtimeFromDefinition(route: RouteDefinition): RuntimeRoute {
  return {
    id: route.id,
    name: route.name,
    nameEn: route.nameEn,
    hotScore: route.hotScore,
    durationSeconds: route.durationSeconds,
    lengthMeters: route.lengthMeters,
    pointCount: route.pointCount,
    points: decodeRoutePoints(route.pointsB64),
    markers: route.markers,
    custom: false,
  };
}

function runtimeFromCustom(route: StoredCustomRoute): RuntimeRoute {
  const points = new Float32Array(route.points.length * 3);
  route.points.forEach((p, i) => {
    points[i * 3] = p.x;
    points[i * 3 + 1] = p.y;
    points[i * 3 + 2] = p.z;
  });
  return {
    id: route.id,
    name: route.name,
    nameEn: null,
    hotScore: 0,
    durationSeconds: route.durationSeconds,
    lengthMeters: route.lengthMeters,
    pointCount: route.points.length,
    points,
    markers: route.markers.map((marker, index) => ({
      name: marker.name,
      nameEn: null,
      desc: "",
      descEn: "",
      pointIndex: index,
      worldPos: marker.worldPos,
      nearestDistance: 0,
    })),
    custom: true,
    description: route.description,
  };
}

/** 读取本地自录路线（按图分组；解析失败回退空表）。 */
export function readStoredCustomRoutes(): Record<string, StoredCustomRoute[]> {
  try {
    const raw = localStorage.getItem(CUSTOM_ROUTES_STORAGE_KEY);
    if (raw === null) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") {
      return {};
    }
    const out: Record<string, StoredCustomRoute[]> = {};
    for (const [code, list] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(list)) {
        out[code] = list.filter((entry): entry is StoredCustomRoute => {
          return (
            typeof entry === "object" &&
            entry !== null &&
            typeof (entry as StoredCustomRoute).id === "string" &&
            Array.isArray((entry as StoredCustomRoute).points)
          );
        });
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeStoredCustomRoutes(all: Record<string, StoredCustomRoute[]>): void {
  try {
    localStorage.setItem(CUSTOM_ROUTES_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // 持久化失败不阻塞交互（隐私模式等场景）。
  }
}

/** 自录路线 → 导出 JSON 文档。 */
export function customRouteToExport(route: StoredCustomRoute): string {
  return JSON.stringify({ format: CUSTOM_ROUTE_EXPORT_FORMAT, route }, null, 2);
}

/** 导入 JSON → 自录路线（格式不符抛错）。 */
export function customRouteFromExport(text: string): StoredCustomRoute {
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object") {
    throw new RangeError("路线文件不是合法 JSON");
  }
  const doc = parsed as { format?: unknown; route?: unknown };
  if (
    doc.format !== CUSTOM_ROUTE_EXPORT_FORMAT ||
    typeof doc.route !== "object" ||
    doc.route === null
  ) {
    throw new RangeError(`路线文件 format 应为 ${CUSTOM_ROUTE_EXPORT_FORMAT}`);
  }
  const route = doc.route as StoredCustomRoute;
  if (typeof route.id !== "string" || !Array.isArray(route.points)) {
    throw new RangeError("路线文件缺少 id/points 字段");
  }
  return route;
}

interface RouteStoreState {
  panelOpen: boolean;
  mode: RoutePanelMode;
  mapCode: MapCode | null;
  status: RoutesStatus;
  errorCode: RouteLoadErrorCode | null;
  builtin: readonly RuntimeRoute[];
  custom: readonly RuntimeRoute[];
  selectedRouteId: string | null;
  /** 详情视图当前呈现的路线（视口据此渲染 3D 主线；null = 清空）。 */
  detailRoute: RuntimeRoute | null;
  /** 跟跑：请求序号（视口据此启动回放）。 */
  followRequestSeq: number;
  followRouteId: string | null;
  followFraction: number;
  followPointIndex: number;
  /** 当前提示标注（跟跑经过的最近标注点；null 无）。 */
  activeMarker: RouteMarker | null;
  /** F 键/交互面板冲突：跟跑中禁用交互提示由视口处理。 */
  record: RecordSession | null;
  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
  showDetail: (routeId: string) => void;
  backToList: () => void;
  loadForMap: (mapCode: MapCode) => Promise<void>;
  requestFollow: (routeId: string) => void;
  stopFollow: () => void;
  /** 视口回放进度上报（fraction ∈ [0,1]）。 */
  reportFollowProgress: (routeId: string, fraction: number, pointIndex: number) => void;
  /** 跟跑结束（自然完成/被打断）落盘终态。 */
  finishFollow: (routeId: string) => void;
  startRecord: () => void;
  pushRecordSample: (position: Vec3) => void;
  addRecordMarker: (name: string, position: Vec3) => void;
  stopRecord: () => StoredCustomRoute | null;
  discardRecord: () => void;
  saveCustomRoute: (name: string, description: string, draft: StoredCustomRoute) => void;
  deleteCustomRoute: (routeId: string) => void;
  importCustomRoute: (route: StoredCustomRoute) => void;
  reset: () => void;
}

const EMPTY_SESSION: RecordSession = { startedAt: 0, points: [], markers: [] };

export const useRouteStore = create<RouteStoreState>()((set, get) => ({
  panelOpen: false,
  mode: "list",
  mapCode: null,
  status: "idle",
  errorCode: null,
  builtin: [],
  custom: [],
  selectedRouteId: null,
  detailRoute: null,
  followRequestSeq: 0,
  followRouteId: null,
  followFraction: 0,
  followPointIndex: 0,
  activeMarker: null,
  record: null,

  togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  showDetail: (routeId) => set({ mode: "detail", selectedRouteId: routeId }),
  backToList: () => set({ mode: "list" }),

  loadForMap: async (mapCode) => {
    const custom = readStoredCustomRoutes()[mapCode] ?? [];
    set({
      mapCode,
      status: "loading",
      errorCode: null,
      mode: "list",
      selectedRouteId: null,
      detailRoute: null,
      followRouteId: null,
      activeMarker: null,
      custom: custom.map(runtimeFromCustom),
      builtin: [],
      record: null,
    });
    try {
      const doc: RoutesDoc = await loadRoutes(mapCode);
      if (get().mapCode !== mapCode) {
        return; // 请求期间已换图
      }
      set({ status: "ready", builtin: doc.routes.map(runtimeFromDefinition) });
    } catch (error) {
      if (get().mapCode !== mapCode) {
        return;
      }
      // 未随应用分发视为空表（呈现空态文案）；其余错误归类记录。
      set({
        status: routeLoadErrorCode(error) === "unavailable" ? "ready" : "unavailable",
        errorCode: routeLoadErrorCode(error),
        builtin: [],
      });
    }
  },

  requestFollow: (routeId) =>
    set((state) => ({
      followRequestSeq: state.followRequestSeq + 1,
      followRouteId: routeId,
      followFraction: 0,
      followPointIndex: 0,
      activeMarker: null,
    })),

  stopFollow: () => set({ followRouteId: null, activeMarker: null, followFraction: 0 }),

  reportFollowProgress: (routeId, fraction, pointIndex) => {
    const state = get();
    if (state.followRouteId !== routeId) {
      return;
    }
    const route = [...state.custom, ...state.builtin].find((entry) => entry.id === routeId);
    let activeMarker = state.activeMarker;
    if (route !== undefined) {
      const passed = route.markers.filter((marker) => marker.pointIndex <= pointIndex);
      activeMarker = passed.length > 0 ? passed[passed.length - 1] : null;
    }
    set({ followFraction: fraction, followPointIndex: pointIndex, activeMarker });
  },

  finishFollow: (routeId) => {
    if (get().followRouteId === routeId) {
      set({ followRouteId: null, activeMarker: null, followFraction: 0 });
    }
  },

  startRecord: () =>
    set({
      record: { startedAt: Date.now(), points: [], markers: [] },
      panelOpen: false,
    }),

  pushRecordSample: (position) => {
    const record = get().record;
    if (record === null) {
      return;
    }
    const last = record.points[record.points.length - 1];
    if (
      last !== undefined &&
      last.x === position.x &&
      last.y === position.y &&
      last.z === position.z
    ) {
      return; // 重复采样去重
    }
    set({ record: { ...record, points: [...record.points, position] } });
  },

  addRecordMarker: (name, position) => {
    const record = get().record;
    if (record === null || name.trim() === "") {
      return;
    }
    set({
      record: {
        ...record,
        markers: [...record.markers, { name: name.trim(), worldPos: position }],
      },
    });
  },

  stopRecord: () => {
    const record = get().record;
    if (record === null || record.points.length < 2) {
      set({ record: null });
      return null;
    }
    const durationSeconds = Math.max((Date.now() - record.startedAt) / 1000, 0.001);
    const draft: StoredCustomRoute = {
      id: `user_${Date.now().toString(36)}`,
      name: "",
      description: "",
      durationSeconds,
      lengthMeters: polylineLength(record.points),
      recordedAt: new Date(record.startedAt).toISOString(),
      points: record.points,
      markers: record.markers,
    };
    set({ record: null });
    return draft;
  },

  discardRecord: () => set({ record: null }),

  saveCustomRoute: (name, description, draft) => {
    const mapCode = get().mapCode;
    if (mapCode === null) {
      return;
    }
    const route: StoredCustomRoute = { ...draft, name: name.trim() || draft.name, description };
    const all = readStoredCustomRoutes();
    const list = all[mapCode] ?? [];
    all[mapCode] = [...list.filter((entry) => entry.id !== route.id), route];
    writeStoredCustomRoutes(all);
    set({
      custom: [...get().custom.filter((entry) => entry.id !== route.id), runtimeFromCustom(route)],
    });
  },

  deleteCustomRoute: (routeId) => {
    const mapCode = get().mapCode;
    if (mapCode === null) {
      return;
    }
    const all = readStoredCustomRoutes();
    all[mapCode] = (all[mapCode] ?? []).filter((entry) => entry.id !== routeId);
    writeStoredCustomRoutes(all);
    set({ custom: get().custom.filter((entry) => entry.id !== routeId) });
  },

  importCustomRoute: (route) => {
    const mapCode = get().mapCode;
    if (mapCode === null) {
      return;
    }
    const all = readStoredCustomRoutes();
    const list = all[mapCode] ?? [];
    all[mapCode] = [...list.filter((entry) => entry.id !== route.id), route];
    writeStoredCustomRoutes(all);
    set({
      custom: [...get().custom.filter((entry) => entry.id !== route.id), runtimeFromCustom(route)],
    });
  },

  reset: () =>
    set({
      panelOpen: false,
      mode: "list",
      status: "idle",
      errorCode: null,
      builtin: [],
      custom: [],
      selectedRouteId: null,
      detailRoute: null,
      followRouteId: null,
      activeMarker: null,
      record: null,
      mapCode: null,
    }),
}));

/** 按下标取路线点位（测试/工具用便捷转发）。 */
export function runtimePointAt(route: RuntimeRoute, index: number): Vec3 {
  return routePointAt(route.points, index);
}

export { EMPTY_SESSION };

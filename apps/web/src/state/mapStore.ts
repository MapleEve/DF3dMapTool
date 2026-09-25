import { create } from "zustand";
import type { MapLoadErrorCode } from "@/data/loadMap";
import { DEFAULT_MAP_ID, type MapId } from "@/map";
import type { ChunkStreamStats } from "@/engine";
import { useFloorStore } from "./floorStore";

export type MapLoadStatus = "idle" | "loading" | "ready" | "error";

interface MapStoreState {
  mapId: MapId;
  status: MapLoadStatus;
  errorCode: MapLoadErrorCode | null;
  /** 加载进度 0..1（仅 loading 态有意义）。 */
  progress: number;
  /** 分块流式加载统计（就绪后由引擎持续推送；仅流式进度徽标消费，不驱动视口重渲染）。 */
  streamStats: ChunkStreamStats | null;
  /** 用户点选了暂无数据包的地图时置位，用于展示“数据包准备中”提示。 */
  unavailableMapId: MapId | null;
  /** 加载序号：每次发起点击递增（含同图位失败后的原位重试），驱动视口重新加载。 */
  loadSeq: number;
  setMap: (mapId: MapId) => void;
  setStatus: (status: MapLoadStatus, errorCode?: MapLoadErrorCode | null) => void;
  setProgress: (progress: number) => void;
  setStreamStats: (stats: ChunkStreamStats) => void;
  notifyUnavailable: (mapId: MapId | null) => void;
}

export const useMapStore = create<MapStoreState>()((set, get) => ({
  mapId: DEFAULT_MAP_ID,
  status: "idle",
  errorCode: null,
  progress: 0,
  streamStats: null,
  unavailableMapId: null,
  loadSeq: 0,
  setMap: (mapId) => {
    // 真实换图时复位 2D 沙盘的楼层值域贡献（同图位重试不动）：
    // 沙盘数据层加载新图数据包后经 setSandboxFloors 重新回填。
    if (mapId !== get().mapId) {
      useFloorStore.getState().setSandboxFloors(null);
    }
    set((state) => ({
      mapId,
      status: "idle",
      errorCode: null,
      progress: 0,
      streamStats: null,
      unavailableMapId: null,
      loadSeq: state.loadSeq + 1,
    }));
  },
  setStatus: (status, errorCode = null) =>
    set((state) => ({
      status,
      errorCode,
      // 离开 loading 态时清掉进度；进入 loading 态从 0 起步，
      // 流式统计同步清零（新一轮加载/同图位重试都从干净状态开始）。
      progress: status === "loading" ? state.progress : 0,
      streamStats: status === "loading" ? null : state.streamStats,
    })),
  setProgress: (progress) => set({ progress }),
  setStreamStats: (streamStats) => set({ streamStats }),
  notifyUnavailable: (unavailableMapId) => set({ unavailableMapId }),
}));

import { create } from 'zustand';
import type { MapLoadErrorCode } from '@/data/loadMap';
import { DEFAULT_MAP_ID, type MapId } from '@/map';

export type MapLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface MapStoreState {
  mapId: MapId;
  status: MapLoadStatus;
  errorCode: MapLoadErrorCode | null;
  /** 加载进度 0..1（仅 loading 态有意义）。 */
  progress: number;
  /** 用户点选了暂无数据包的地图时置位，用于展示“数据包准备中”提示。 */
  unavailableMapId: MapId | null;
  setMap: (mapId: MapId) => void;
  setStatus: (status: MapLoadStatus, errorCode?: MapLoadErrorCode | null) => void;
  setProgress: (progress: number) => void;
  notifyUnavailable: (mapId: MapId | null) => void;
}

export const useMapStore = create<MapStoreState>()((set) => ({
  mapId: DEFAULT_MAP_ID,
  status: 'idle',
  errorCode: null,
  progress: 0,
  unavailableMapId: null,
  setMap: (mapId) => set({ mapId, status: 'idle', errorCode: null, progress: 0, unavailableMapId: null }),
  setStatus: (status, errorCode = null) =>
    set((state) => ({
      status,
      errorCode,
      // 离开 loading 态时清掉进度；进入 loading 态从 0 起步。
      progress: status === 'loading' ? state.progress : 0,
    })),
  setProgress: (progress) => set({ progress }),
  notifyUnavailable: (unavailableMapId) => set({ unavailableMapId }),
}));

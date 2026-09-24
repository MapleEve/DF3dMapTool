import { create } from 'zustand';
import type { MapBundle, MapPoiData } from '@/data';

/**
 * 已加载地图数据包的运行时持有层。
 * loader/派生数据为非序列化对象，只供渲染层读取，不参与持久化。
 */
interface MapDataStoreState {
  mapId: number | null;
  bundle: MapBundle | null;
  poiData: MapPoiData | null;
  setMapData: (mapId: number, bundle: MapBundle, poiData: MapPoiData) => void;
  clear: () => void;
}

export const useMapDataStore = create<MapDataStoreState>()((set) => ({
  mapId: null,
  bundle: null,
  poiData: null,
  setMapData: (mapId, bundle, poiData) => set({ mapId, bundle, poiData }),
  clear: () => set({ mapId: null, bundle: null, poiData: null }),
}));

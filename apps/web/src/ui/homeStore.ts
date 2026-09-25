import { create } from "zustand";
import { getMapById, type MapId } from "@/map";
import { useMapStore } from "@/state/mapStore";

/**
 * 选图屏状态（应用壳入口层，仅 UI 侧消费）。
 *
 * 选图屏是「视觉覆盖层」而非阻塞首屏：壳与默认图照常加载，
 * ?map=<MapId 数字> 直进时在客户端挂载后关闭选图屏（对齐上游
 * 直进参数语义：数字 MapId 有效、字符串代号无效）。
 */
interface HomeStoreState {
  homeOpen: boolean;
  /** 进入工具（关闭选图屏）。 */
  enter: () => void;
  /** 重新打开选图屏（设置菜单「切换地图」入口）。 */
  openHome: () => void;
  /** URL 直进解析：?map=<数字> 时切图并直接进入，返回是否命中。 */
  consumeDeepLink: () => boolean;
}

export const useHomeStore = create<HomeStoreState>()((set, get) => ({
  homeOpen: true,
  enter: () => set({ homeOpen: false }),
  openHome: () => set({ homeOpen: true }),
  consumeDeepLink: () => {
    if (get().homeOpen !== true) {
      return false;
    }
    if (typeof window === "undefined") {
      return false;
    }
    const raw = new URLSearchParams(window.location.search).get("map");
    if (raw === null || !/^\d+$/.test(raw)) {
      return false;
    }
    const id = Number(raw) as MapId;
    if (getMapById(id) === undefined) {
      return false;
    }
    if (useMapStore.getState().mapId !== id) {
      useMapStore.getState().setMap(id);
    }
    set({ homeOpen: false });
    return true;
  },
}));

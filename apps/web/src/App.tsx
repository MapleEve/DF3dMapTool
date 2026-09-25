import { useEffect } from "react";
import { Sandbox2dView } from "@/sandbox2d";
import { BigmapOverlay } from "./ui/BigmapOverlay";
import { CollectionPanel } from "./ui/CollectionPanel";
import { KeyTipsHud } from "./ui/KeyTipsHud";
import { MapSelectScreen } from "./ui/MapSelectScreen";
import { MapViewport } from "./ui/MapViewport";
import { RouteHud } from "./ui/RouteHud";
import { RoutePanel } from "./ui/RoutePanel";
import { RouteRecording } from "./ui/RouteRecording";
import { SettingsPanel } from "./ui/SettingsPanel";
import { Sidebar } from "./ui/Sidebar";
import { StatusBar } from "./ui/StatusBar";
import { TopBar } from "./ui/TopBar";
import { ViewCouplingBridge } from "./ui/ViewCouplingBridge";
import { LoadingFlow } from "./ui/loading/LoadingFlow";
import { useHomeStore } from "./ui/homeStore";
import { useUiStore } from "./state/uiStore";
import { useViewStore } from "./state/viewStore";
import { useRouteStore } from "./state/routeStore";
import "./ui/ui.css";

export default function App() {
  const bigmapOpen = useUiStore((state) => state.bigmapOpen);
  const toggleBigmap = useUiStore((state) => state.toggleBigmap);
  const setBigmapOpen = useUiStore((state) => state.setBigmapOpen);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const view = useViewStore((state) => state.view);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Esc 逐层（#57：3D 视图无面板时呼出设置菜单）：
        // 设置面板的 Esc 由 SettingsPanel 自身处理（重置确认 toast 优先），
        // 此处只处理其余层级：选图屏 → 2D 沙盘浮动面板 → 俯视大地图 → 呼出设置。
        if (useUiStore.getState().settingsOpen) {
          return;
        }
        if (useHomeStore.getState().homeOpen) {
          useHomeStore.getState().enter();
          return;
        }
        if (useViewStore.getState().view === "2d") {
          useViewStore.getState().sandboxDismiss?.();
          return;
        }
        if (useUiStore.getState().bigmapOpen) {
          setBigmapOpen(false);
          return;
        }
        setSettingsOpen(true);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const target = event.target;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;
      // M 键（俯视大地图）仅在 3D 视图且无顶层模态时生效；2D 沙盘是独立全页视图，不经此键。
      if (
        !typing &&
        event.key.toLowerCase() === "m" &&
        useViewStore.getState().view === "3d" &&
        !useUiStore.getState().settingsOpen &&
        !useHomeStore.getState().homeOpen
      ) {
        event.preventDefault();
        toggleBigmap();
      }
      // Q 键（路线面板）同 M 键口径：仅 3D 视图、无顶层模态、非输入态。
      if (
        !typing &&
        event.key.toLowerCase() === "q" &&
        useViewStore.getState().view === "3d" &&
        !useUiStore.getState().settingsOpen &&
        !useHomeStore.getState().homeOpen
      ) {
        event.preventDefault();
        useRouteStore.getState().togglePanel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleBigmap, setBigmapOpen, setSettingsOpen]);

  // 进入 2D 视图时收起 3D 专属覆盖层（俯视大地图不跨视图保留）。
  useEffect(() => {
    if (view === "2d") {
      setBigmapOpen(false);
      useRouteStore.getState().setPanelOpen(false);
    }
  }, [view, setBigmapOpen]);

  return (
    <div className="app-root">
      {/* 3D 场景保持挂载：2D 视图下隐藏并暂停渲染循环（相机/分块缓存/标注全保留，切回零成本）。 */}
      <MapViewport hidden={view === "2d"} />
      {view === "2d" ? <Sandbox2dView /> : null}
      <TopBar />
      {view === "3d" ? <Sidebar /> : null}
      {view === "3d" ? <KeyTipsHud /> : null}
      {view === "3d" ? <RouteHud /> : null}
      {view === "3d" ? <RoutePanel /> : null}
      {view === "3d" ? <RouteRecording /> : null}
      {view === "3d" && bigmapOpen ? <BigmapOverlay /> : null}
      <SettingsPanel />
      <CollectionPanel />
      <StatusBar />
      <ViewCouplingBridge />
      {/* 选图屏：入口层覆盖（?map= 直进时挂载即关闭），壳与默认图照常加载。 */}
      <MapSelectScreen />
      {/* 加载流程：启动 boot 屏 → 选图屏/进图屏（大百分比）→ 3D 视图，完成均为硬切。 */}
      <LoadingFlow />
    </div>
  );
}

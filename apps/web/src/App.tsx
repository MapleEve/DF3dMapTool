import { useEffect } from "react";
import { Sandbox2dView } from "@/sandbox2d";
import { BigmapOverlay } from "./ui/BigmapOverlay";
import { MapViewport } from "./ui/MapViewport";
import { SettingsPanel } from "./ui/SettingsPanel";
import { Sidebar } from "./ui/Sidebar";
import { StatusBar } from "./ui/StatusBar";
import { TopBar } from "./ui/TopBar";
import { ViewCouplingBridge } from "./ui/ViewCouplingBridge";
import { useUiStore } from "./state/uiStore";
import { useViewStore } from "./state/viewStore";
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
        // Esc 逐层关闭（设置面板是最顶层模态，先于视图内浮动面板）：
        // 3D 视图：设置 → 俯视大地图；2D 视图：设置 → 沙盘注册的关闭器（详情面板/坐标弹窗）。
        if (useUiStore.getState().settingsOpen) {
          setSettingsOpen(false);
          return;
        }
        if (useViewStore.getState().view === "2d") {
          useViewStore.getState().sandboxDismiss?.();
          return;
        }
        if (useUiStore.getState().bigmapOpen) {
          setBigmapOpen(false);
        }
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
      // M 键（俯视大地图）仅在 3D 视图生效；2D 沙盘是独立全页视图，不经此键。
      if (!typing && event.key.toLowerCase() === "m" && useViewStore.getState().view === "3d") {
        event.preventDefault();
        toggleBigmap();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleBigmap, setBigmapOpen, setSettingsOpen]);

  // 进入 2D 视图时收起 3D 专属覆盖层（俯视大地图不跨视图保留）。
  useEffect(() => {
    if (view === "2d") {
      setBigmapOpen(false);
    }
  }, [view, setBigmapOpen]);

  return (
    <div className="app-root">
      {/* 3D 场景保持挂载：2D 视图下隐藏并暂停渲染循环（相机/分块缓存/标注全保留，切回零成本）。 */}
      <MapViewport hidden={view === "2d"} />
      {view === "2d" ? <Sandbox2dView /> : null}
      <TopBar />
      {view === "3d" ? <Sidebar /> : null}
      {view === "3d" && bigmapOpen ? <BigmapOverlay /> : null}
      <SettingsPanel />
      <StatusBar />
      <ViewCouplingBridge />
    </div>
  );
}

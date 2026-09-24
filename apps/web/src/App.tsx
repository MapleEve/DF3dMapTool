import { useEffect } from "react";
import { BigmapOverlay } from "./ui/BigmapOverlay";
import { MapViewport } from "./ui/MapViewport";
import { SettingsPanel } from "./ui/SettingsPanel";
import { Sidebar } from "./ui/Sidebar";
import { StatusBar } from "./ui/StatusBar";
import { TopBar } from "./ui/TopBar";
import { useUiStore } from "./state/uiStore";
import "./ui/ui.css";

export default function App() {
  const bigmapOpen = useUiStore((state) => state.bigmapOpen);
  const toggleBigmap = useUiStore((state) => state.toggleBigmap);
  const setBigmapOpen = useUiStore((state) => state.setBigmapOpen);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Esc 逐层关闭：先设置面板，再大地图。
        if (useUiStore.getState().settingsOpen) {
          setSettingsOpen(false);
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
      if (!typing && event.key.toLowerCase() === "m") {
        event.preventDefault();
        toggleBigmap();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleBigmap, setBigmapOpen, setSettingsOpen]);

  return (
    <div className="app-root">
      <MapViewport />
      <TopBar />
      <Sidebar />
      {bigmapOpen ? <BigmapOverlay /> : null}
      <SettingsPanel />
      <StatusBar />
    </div>
  );
}

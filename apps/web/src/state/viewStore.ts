import { create } from "zustand";

/** 视图模式：3D 沙盘（默认）或全页 2D 沙盘。 */
export type ViewMode = "3d" | "2d";

/** 视图偏好的持久化键。 */
export const STORAGE_KEY_VIEW = "df3dmaptool:view";

/** 读取持久化的视图偏好（启动恢复用；异常/缺省/非法值回退 3D）。 */
export function readStoredView(): ViewMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_VIEW);
    return stored === "2d" || stored === "3d" ? stored : "3d";
  } catch {
    return "3d";
  }
}

function persistView(view: ViewMode): void {
  try {
    localStorage.setItem(STORAGE_KEY_VIEW, view);
  } catch {
    // 持久化失败不阻塞切换（隐私模式等场景）。
  }
}

/**
 * 2D 视图浮动面板的 Esc 关闭器：返回 true 表示关闭了自身某个面板（消费该次 Esc）。
 * 2D 沙盘视图挂载时注册，卸载时注销；App 外壳据此实现 Esc 逐层关闭。
 */
export type SandboxDismissHandler = () => boolean;

interface ViewStoreState {
  view: ViewMode;
  setView: (view: ViewMode) => void;
  toggleView: () => void;
  /** 2D 沙盘视图注册的 Esc 关闭器（null 表示 2D 视图无浮动面板）。 */
  sandboxDismiss: SandboxDismissHandler | null;
  registerSandboxDismiss: (handler: SandboxDismissHandler | null) => void;
}

export const useViewStore = create<ViewStoreState>()((set, get) => ({
  view: readStoredView(),
  setView: (view) => {
    persistView(view);
    set({ view });
  },
  toggleView: () => {
    get().setView(get().view === "3d" ? "2d" : "3d");
  },
  sandboxDismiss: null,
  registerSandboxDismiss: (sandboxDismiss) => set({ sandboxDismiss }),
}));

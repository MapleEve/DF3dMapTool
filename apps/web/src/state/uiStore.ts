import { create } from 'zustand';
import type { Vec3 } from '@/common/geometry';
import { changeLanguage, DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, type Language } from '@/i18n';

/** 画质档位：映射到渲染像素比上限（低 1 / 中 1.5 / 高 2）。 */
export type QualityLevel = 'low' | 'medium' | 'high';

export const QUALITY_PIXEL_RATIO: Readonly<Record<QualityLevel, number>> = {
  low: 1,
  medium: 1.5,
  high: 2,
};

const STORAGE_KEY_QUALITY = 'df3dmaptool:quality';

function readStoredLanguage(): Language {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return stored === 'en' || stored === 'zh' ? stored : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

function readStoredQuality(): QualityLevel {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_QUALITY);
    return stored === 'low' || stored === 'medium' || stored === 'high' ? stored : 'high';
  } catch {
    return 'high';
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 持久化失败不阻塞交互（隐私模式等场景）。
  }
}

/** 底部 HUD 展示的相机状态（节流更新）。 */
export interface CameraHud {
  readonly position: Vec3;
  /** 相机方位角（弧度，0 = 世界 -Z 方向）。 */
  readonly yaw: number;
}

interface UiStoreState {
  sidebarOpen: boolean;
  bigmapOpen: boolean;
  settingsOpen: boolean;
  language: Language;
  quality: QualityLevel;
  cameraHud: CameraHud | null;
  /** 视口注册的截图执行器（null 表示视口未就绪）。 */
  screenshotHandler: (() => void) | null;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleBigmap: () => void;
  setBigmapOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setLanguage: (language: Language) => void;
  setQuality: (quality: QualityLevel) => void;
  setCameraHud: (hud: CameraHud | null) => void;
  registerScreenshot: (handler: (() => void) | null) => void;
}

export const useUiStore = create<UiStoreState>()((set) => ({
  sidebarOpen: true,
  bigmapOpen: false,
  settingsOpen: false,
  language: readStoredLanguage(),
  quality: readStoredQuality(),
  cameraHud: null,
  screenshotHandler: null,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleBigmap: () => set((state) => ({ bigmapOpen: !state.bigmapOpen })),
  setBigmapOpen: (bigmapOpen) => set({ bigmapOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setLanguage: (language) => {
    void changeLanguage(language);
    persist(LANGUAGE_STORAGE_KEY, language);
    set({ language });
  },
  setQuality: (quality) => {
    persist(STORAGE_KEY_QUALITY, quality);
    set({ quality });
  },
  setCameraHud: (cameraHud) => set({ cameraHud }),
  registerScreenshot: (screenshotHandler) => set({ screenshotHandler }),
}));

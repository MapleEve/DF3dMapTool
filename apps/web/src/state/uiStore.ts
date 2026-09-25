import { create } from "zustand";
import type { Vec3 } from "@/common/geometry";
import { changeLanguage, readStoredLanguage, LANGUAGE_STORAGE_KEY, type Language } from "@/i18n";

/** 画质档位：映射到渲染像素比上限（低 1 / 中 1.5 / 高 2）。 */
export type QualityLevel = "low" | "medium" | "high";

export const QUALITY_PIXEL_RATIO: Readonly<Record<QualityLevel, number>> = {
  low: 1,
  medium: 1.5,
  high: 2,
};

/** 相机视场角范围与默认值（度），与 MapCameraLimits.fovRange 对齐。 */
export const FOV_RANGE = [30, 100] as const;
export const FOV_DEFAULT = 70;

/** 视角灵敏度范围与默认值（1 为默认手感），与引擎 setSensitivity 钳制对齐。 */
export const SENSITIVITY_RANGE = [0.2, 3] as const;
export const SENSITIVITY_DEFAULT = 1;

/** 帧率上限档位：null 为不限（跟随显示器刷新率）。 */
export type FrameLimitLevel = "unlimited" | "30" | "60";
export const FRAME_LIMIT_FPS: Readonly<Record<FrameLimitLevel, number | null>> = {
  unlimited: null,
  "30": 30,
  "60": 60,
};

const STORAGE_KEY_QUALITY = "df3dmaptool:quality";
const STORAGE_KEY_FOV = "df3dmaptool:fov";
const STORAGE_KEY_SENSITIVITY = "df3dmaptool:sensitivity";
const STORAGE_KEY_FRAME_LIMIT = "df3dmaptool:frameLimit";
const STORAGE_KEY_ANTIALIAS = "df3dmaptool:antialias";
const STORAGE_KEY_AIR_JUMP = "df3dmaptool:airJump";
const STORAGE_KEY_VOLUME = "df3dmaptool:volume";
const STORAGE_KEY_AMBIENT_MOTES = "df3dmaptool:ambientMotes";

function readStoredQuality(): QualityLevel {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_QUALITY);
    return stored === "low" || stored === "medium" || stored === "high" ? stored : "high";
  } catch {
    return "high";
  }
}

function clampRange(value: number, range: readonly [number, number], fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(range[1], Math.max(range[0], value));
}

function readStoredNumber(key: string, range: readonly [number, number], fallback: number): number {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) {
      return fallback;
    }
    return clampRange(Number(stored), range, fallback);
  } catch {
    return fallback;
  }
}

function readStoredFrameLimit(): FrameLimitLevel {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_FRAME_LIMIT);
    return stored === "30" || stored === "60" || stored === "unlimited" ? stored : "unlimited";
  } catch {
    return "unlimited";
  }
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === "1";
  } catch {
    return fallback;
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
  /** 相机视场角（度）。 */
  fov: number;
  /** 视角灵敏度（1 为默认手感）。 */
  sensitivity: number;
  /** 帧率上限档位。 */
  frameLimit: FrameLimitLevel;
  /** 抗锯齿（重建渲染器才生效，重启页面后应用）。 */
  antialias: boolean;
  /** 空中跳跃（上游对齐设置项；模拟器无角色控制，仅保存偏好）。 */
  airJump: boolean;
  /** 音量百分比 0..100（模拟器暂无音频输出，仅保存偏好）。 */
  volume: number;
  /** 环境漂浮粒子（模拟器暂无对应视觉系统，仅保存偏好）。 */
  ambientMotes: boolean;
  cameraHud: CameraHud | null;
  /** 视口注册的截图执行器（null 表示视口未就绪）。 */
  screenshotHandler: (() => void) | null;
  /** 视口注册的回出生点执行器（null 表示视口未就绪）。 */
  respawnHandler: (() => void) | null;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleBigmap: () => void;
  setBigmapOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setLanguage: (language: Language) => void;
  setQuality: (quality: QualityLevel) => void;
  setFov: (fov: number) => void;
  setSensitivity: (sensitivity: number) => void;
  setFrameLimit: (level: FrameLimitLevel) => void;
  setAntialias: (antialias: boolean) => void;
  setAirJump: (airJump: boolean) => void;
  setVolume: (volume: number) => void;
  setAmbientMotes: (ambientMotes: boolean) => void;
  setCameraHud: (hud: CameraHud | null) => void;
  registerScreenshot: (handler: (() => void) | null) => void;
  registerRespawn: (handler: (() => void) | null) => void;
  /** 执行回出生点（视口未就绪时静默忽略）。 */
  requestRespawn: () => void;
}

export const useUiStore = create<UiStoreState>()((set, get) => ({
  sidebarOpen: true,
  bigmapOpen: false,
  settingsOpen: false,
  language: readStoredLanguage(),
  quality: readStoredQuality(),
  fov: readStoredNumber(STORAGE_KEY_FOV, FOV_RANGE, FOV_DEFAULT),
  sensitivity: readStoredNumber(STORAGE_KEY_SENSITIVITY, SENSITIVITY_RANGE, SENSITIVITY_DEFAULT),
  frameLimit: readStoredFrameLimit(),
  antialias: readStoredBoolean(STORAGE_KEY_ANTIALIAS, true),
  airJump: readStoredBoolean(STORAGE_KEY_AIR_JUMP, true),
  volume: readStoredNumber(STORAGE_KEY_VOLUME, [0, 100], 80),
  ambientMotes: readStoredBoolean(STORAGE_KEY_AMBIENT_MOTES, true),
  cameraHud: null,
  screenshotHandler: null,
  respawnHandler: null,
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
  setFov: (fov) => {
    const next = clampRange(fov, FOV_RANGE, FOV_DEFAULT);
    persist(STORAGE_KEY_FOV, String(next));
    set({ fov: next });
  },
  setSensitivity: (sensitivity) => {
    const next = clampRange(sensitivity, SENSITIVITY_RANGE, SENSITIVITY_DEFAULT);
    persist(STORAGE_KEY_SENSITIVITY, String(next));
    set({ sensitivity: next });
  },
  setFrameLimit: (frameLimit) => {
    persist(STORAGE_KEY_FRAME_LIMIT, frameLimit);
    set({ frameLimit });
  },
  setAntialias: (antialias) => {
    persist(STORAGE_KEY_ANTIALIAS, antialias ? "1" : "0");
    set({ antialias });
  },
  setAirJump: (airJump) => {
    persist(STORAGE_KEY_AIR_JUMP, airJump ? "1" : "0");
    set({ airJump });
  },
  setVolume: (volume) => {
    const next = clampRange(volume, [0, 100], 80);
    persist(STORAGE_KEY_VOLUME, String(Math.round(next)));
    set({ volume: next });
  },
  setAmbientMotes: (ambientMotes) => {
    persist(STORAGE_KEY_AMBIENT_MOTES, ambientMotes ? "1" : "0");
    set({ ambientMotes });
  },
  setCameraHud: (cameraHud) => set({ cameraHud }),
  registerScreenshot: (screenshotHandler) => set({ screenshotHandler }),
  registerRespawn: (respawnHandler) => set({ respawnHandler }),
  requestRespawn: () => {
    const handler = get().respawnHandler;
    handler?.();
  },
}));

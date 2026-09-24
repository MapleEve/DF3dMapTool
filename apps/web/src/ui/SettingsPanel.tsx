import { useEffect, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, type Language } from "@/i18n";
import {
  FOV_RANGE,
  SENSITIVITY_RANGE,
  useUiStore,
  type FrameLimitLevel,
  type QualityLevel,
} from "@/state/uiStore";

const QUALITY_LEVELS: readonly QualityLevel[] = ["low", "medium", "high"];
const FRAME_LIMIT_LEVELS: readonly FrameLimitLevel[] = ["unlimited", "60", "30"];

type SettingsTab = "graphics" | "general";

/** 设置面板（双 Tab）：画面（画质/抗锯齿/帧率/全屏/视场角）与通用（语言/灵敏度/回出生点/源站对齐项）。 */
export function SettingsPanel() {
  const { t } = useTranslation();
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const [tab, setTab] = useState<SettingsTab>("graphics");

  // Esc 关闭（与源站菜单一致）。
  useEffect(() => {
    if (!settingsOpen) {
      return;
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [settingsOpen, setSettingsOpen]);

  if (!settingsOpen) {
    return null;
  }

  return (
    <div className="settings-backdrop" onClick={() => setSettingsOpen(false)}>
      <section
        className="settings-panel"
        role="dialog"
        aria-label={t("settings.title")}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <h2>{t("settings.title")}</h2>
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            aria-label={t("common.close")}
          >
            ×
          </button>
        </header>

        <div className="settings-tabs" role="tablist">
          {(["graphics", "general"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? "settings-tab active" : "settings-tab"}
              onClick={() => setTab(key)}
            >
              {t(`settings.tabs.${key}`)}
            </button>
          ))}
        </div>

        {tab === "graphics" ? <GraphicsTab /> : <GeneralTab />}
      </section>
    </div>
  );
}

/** 切换全屏（不依赖组件闭包；开关状态由 fullscreenchange 事件同步）。 */
function toggleFullscreen(): void {
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => {});
  } else {
    // 浏览器要求全屏由用户手势触发；失败时静默（开关状态由事件同步）。
    void document.documentElement.requestFullscreen().catch(() => {});
  }
}

/** 画面 Tab：画质、抗锯齿、帧率上限、全屏、视场角。 */
function GraphicsTab() {
  const { t } = useTranslation();
  const quality = useUiStore((state) => state.quality);
  const setQuality = useUiStore((state) => state.setQuality);
  const antialias = useUiStore((state) => state.antialias);
  const setAntialias = useUiStore((state) => state.setAntialias);
  const frameLimit = useUiStore((state) => state.frameLimit);
  const setFrameLimit = useUiStore((state) => state.setFrameLimit);
  const fov = useUiStore((state) => state.fov);
  const setFov = useUiStore((state) => state.setFov);
  const [fullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement));

  // 跟随系统全屏状态（F11 / 浏览器控件也能改变）。
  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  return (
    <>
      <div className="settings-row">
        <label htmlFor="settings-quality">{t("settings.quality")}</label>
        <select
          id="settings-quality"
          value={quality}
          onChange={(event) => {
            const next = event.target.value;
            if (QUALITY_LEVELS.includes(next as QualityLevel)) {
              setQuality(next as QualityLevel);
            }
          }}
        >
          {QUALITY_LEVELS.map((level) => (
            <option key={level} value={level}>
              {t(`settings.qualityLevels.${level}`)}
            </option>
          ))}
        </select>
      </div>
      <p className="settings-hint">{t("settings.qualityHint")}</p>

      <div className="settings-row">
        <label htmlFor="settings-antialias">{t("settings.antialias")}</label>
        <button
          id="settings-antialias"
          type="button"
          role="switch"
          aria-checked={antialias}
          className={antialias ? "settings-switch on" : "settings-switch"}
          onClick={() => setAntialias(!antialias)}
        >
          {antialias ? t("settings.on") : t("settings.off")}
        </button>
      </div>
      <p className="settings-hint">{t("settings.antialiasHint")}</p>

      <div className="settings-row">
        <label htmlFor="settings-frame-limit">{t("settings.frameLimit")}</label>
        <select
          id="settings-frame-limit"
          value={frameLimit}
          onChange={(event) => {
            const next = event.target.value;
            if (FRAME_LIMIT_LEVELS.includes(next as FrameLimitLevel)) {
              setFrameLimit(next as FrameLimitLevel);
            }
          }}
        >
          {FRAME_LIMIT_LEVELS.map((level) => (
            <option key={level} value={level}>
              {t(`settings.frameLimitLevels.${level}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="settings-row">
        <label htmlFor="settings-fullscreen">{t("settings.fullscreen")}</label>
        <button
          id="settings-fullscreen"
          type="button"
          role="switch"
          aria-checked={fullscreen}
          className={fullscreen ? "settings-switch on" : "settings-switch"}
          onClick={toggleFullscreen}
        >
          {fullscreen ? t("settings.on") : t("settings.off")}
        </button>
      </div>
      <p className="settings-hint">{t("settings.fullscreenHint")}</p>

      <div className="settings-row">
        <label htmlFor="settings-fov">{t("settings.fov")}</label>
        <span className="settings-slider-value">{Math.round(fov)}°</span>
      </div>
      <input
        id="settings-fov"
        type="range"
        min={FOV_RANGE[0]}
        max={FOV_RANGE[1]}
        step={1}
        value={Math.round(fov)}
        onChange={(event) => setFov(Number(event.target.value))}
      />
    </>
  );
}

/** 通用 Tab：语言、灵敏度、回出生点、空中跳跃/音量/环境粒子（源站对齐项）。 */
function GeneralTab() {
  const { t } = useTranslation();
  const language = useUiStore((state) => state.language);
  const setLanguage = useUiStore((state) => state.setLanguage);
  const sensitivity = useUiStore((state) => state.sensitivity);
  const setSensitivity = useUiStore((state) => state.setSensitivity);
  const requestRespawn = useUiStore((state) => state.requestRespawn);
  const airJump = useUiStore((state) => state.airJump);
  const setAirJump = useUiStore((state) => state.setAirJump);
  const volume = useUiStore((state) => state.volume);
  const setVolume = useUiStore((state) => state.setVolume);
  const ambientMotes = useUiStore((state) => state.ambientMotes);
  const setAmbientMotes = useUiStore((state) => state.setAmbientMotes);

  const handleLanguageChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    if (SUPPORTED_LANGUAGES.includes(next as Language)) {
      setLanguage(next as Language);
    }
  };

  return (
    <>
      <div className="settings-row">
        <label htmlFor="settings-language">{t("settings.language")}</label>
        <select id="settings-language" value={language} onChange={handleLanguageChange}>
          {SUPPORTED_LANGUAGES.map((code) => (
            <option key={code} value={code}>
              {code === "zh" ? "中文" : "English"}
            </option>
          ))}
        </select>
      </div>

      <div className="settings-row">
        <label htmlFor="settings-sensitivity">{t("settings.sensitivity")}</label>
        <span className="settings-slider-value">{sensitivity.toFixed(2)}×</span>
      </div>
      <input
        id="settings-sensitivity"
        type="range"
        min={SENSITIVITY_RANGE[0]}
        max={SENSITIVITY_RANGE[1]}
        step={0.05}
        value={sensitivity}
        onChange={(event) => setSensitivity(Number(event.target.value))}
      />

      <div className="settings-row">
        <label htmlFor="settings-respawn">{t("settings.respawn")}</label>
        <button
          id="settings-respawn"
          type="button"
          className="settings-action"
          onClick={requestRespawn}
        >
          {t("settings.respawnAction")}
        </button>
      </div>

      <div className="settings-row">
        <label htmlFor="settings-air-jump">{t("settings.airJump")}</label>
        <ToggleSwitch
          id="settings-air-jump"
          checked={airJump}
          onChange={setAirJump}
          label={airJump ? t("settings.on") : t("settings.off")}
        />
      </div>
      <p className="settings-hint">{t("settings.airJumpHint")}</p>

      <div className="settings-row">
        <label htmlFor="settings-volume">{t("settings.volume")}</label>
        <span className="settings-slider-value">{Math.round(volume)}%</span>
      </div>
      <input
        id="settings-volume"
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(volume)}
        onChange={(event) => setVolume(Number(event.target.value))}
      />
      <p className="settings-hint">{t("settings.volumeHint")}</p>

      <div className="settings-row">
        <label htmlFor="settings-ambient-motes">{t("settings.ambientMotes")}</label>
        <ToggleSwitch
          id="settings-ambient-motes"
          checked={ambientMotes}
          onChange={setAmbientMotes}
          label={ambientMotes ? t("settings.on") : t("settings.off")}
        />
      </div>
      <p className="settings-hint">{t("settings.ambientMotesHint")}</p>
    </>
  );
}

function ToggleSwitch({
  id,
  checked,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      className={checked ? "settings-switch on" : "settings-switch"}
      onClick={() => onChange(!checked)}
    >
      {label}
    </button>
  );
}

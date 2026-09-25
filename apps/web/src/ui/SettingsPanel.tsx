import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, type Language } from "@/i18n";
import {
  FOV_DEFAULT,
  FOV_RANGE,
  RENDER_DISTANCE_DEFAULT,
  RENDER_DISTANCE_RANGE,
  SENSITIVITY_DEFAULT,
  SENSITIVITY_RANGE,
  useUiStore,
  type FrameLimitLevel,
  type QualityLevel,
} from "@/state/uiStore";
import { useHomeStore } from "./homeStore";

const QUALITY_LEVELS: readonly QualityLevel[] = ["low", "medium", "high"];
const FRAME_LIMIT_LEVELS: readonly FrameLimitLevel[] = ["unlimited", "60", "30"];

/**
 * 设置模态 = Esc 设置菜单（#57）。
 *
 * 结构口径上游实测锚定：
 * - 「设置」水印 80px 白@0.102；「参数设置」页签 36px（页签组 262x48）；
 * - 参数行 1050x54：标签 16px 白、值 16px 白@0.502、
 *   滑杆 374x22、toggle 开/关、行分隔线 1px 白@0.102；列表底 #202A33@0.902；
 * - 底栏：返回 16px 白@0.698 + 切换地图 240x64 黑字 + 退出工具 240x64 绿字；
 * - 重置=确认弹窗 440x264：标题 28px/内容 24px #B5B7B8/确定绿字/取消黑字。
 * 页签只保留「参数设置」（客户端下载/反馈二维码区无真实对应物，不放）。
 */
export function SettingsPanel() {
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  // 内容子树仅在打开时挂载：重置确认等局部状态随关闭自然复位（无清理副作用）。
  if (!settingsOpen) {
    return null;
  }
  return <SettingsPanelContent />;
}

function SettingsPanelContent() {
  const { t } = useTranslation();
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const openHome = useHomeStore((state) => state.openHome);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Esc 逐层返回：重置确认 toast 优先，其次关闭设置（上游设置内 Esc=返回）。
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (useUiStore.getState().settingsOpen) {
        event.preventDefault();
        if (confirmOpen) {
          setConfirmOpen(false);
        } else {
          setSettingsOpen(false);
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [confirmOpen, setSettingsOpen]);

  const handleSwitchMap = () => {
    setSettingsOpen(false);
    openHome();
  };

  // 退出工具：脚本打开的页可 window.close() 直接关闭；被浏览器拦截时
  // 退回选图屏（离开当前图 = 退出工具态，不放假按钮）。
  const handleExitTool = () => {
    setSettingsOpen(false);
    window.close();
    openHome();
  };

  return (
    <div
      className="settings-backdrop"
      onClick={() => {
        setConfirmOpen(false);
        setSettingsOpen(false);
      }}
    >
      <section
        className="settings-root"
        role="dialog"
        aria-label={t("settings.title")}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="settings-watermark" aria-hidden="true">
          {t("settings.title")}
        </h2>
        <header className="settings-header">
          <div className="settings-tabs" role="tablist">
            <button type="button" role="tab" aria-selected className="settings-tab active">
              {t("settings.paramTab")}
            </button>
          </div>
          <button type="button" className="settings-reset" onClick={() => setConfirmOpen(true)}>
            {t("settings.reset")}
          </button>
        </header>

        <div className="settings-list">
          <div className="settings-list-inner">
            <ParameterRows />
          </div>
        </div>

        <footer className="settings-footer">
          <button type="button" className="settings-back" onClick={() => setSettingsOpen(false)}>
            {t("settings.back")}
          </button>
          <div className="settings-footer-spacer" />
          <button type="button" className="settings-switch-map" onClick={handleSwitchMap}>
            {t("settings.switchMap")}
          </button>
          <button type="button" className="settings-exit" onClick={handleExitTool}>
            {t("settings.exitTool")}
          </button>
        </footer>

        {confirmOpen ? (
          <ResetConfirmToast
            onCancel={() => setConfirmOpen(false)}
            onConfirm={() => {
              resetAllSettings();
              setConfirmOpen(false);
            }}
          />
        ) : null}
      </section>
    </div>
  );
}

/** 全部设置恢复默认值（与 uiStore 初始默认一致；经 setter 持久化）。 */
function resetAllSettings(): void {
  const store = useUiStore.getState();
  store.setQuality("high");
  store.setFov(FOV_DEFAULT);
  store.setSensitivity(SENSITIVITY_DEFAULT);
  store.setRenderDistance(RENDER_DISTANCE_DEFAULT);
  store.setFrameLimit("unlimited");
  store.setAntialias(true);
  store.setAirJump(true);
  store.setVolume(80);
  store.setAmbientMotes(true);
}

/** 重置确认 toast（确认弹窗 440x264 口径）。 */
function ResetConfirmToast({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="settings-toast"
      role="alertdialog"
      aria-label={t("settings.resetTitle")}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="settings-toast-panel">
        <h3 className="settings-toast-title">{t("settings.resetTitle")}</h3>
        <p className="settings-toast-body">{t("settings.resetBody")}</p>
        <div className="settings-toast-actions">
          <button type="button" className="settings-toast-confirm" onClick={onConfirm}>
            {t("settings.confirm")}
          </button>
          <button type="button" className="settings-toast-cancel" onClick={onCancel}>
            {t("settings.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 参数行外壳：标签 16px 白 + 控制区 + 说明列（参数行 1050x54）。 */
function SettingRow({
  htmlFor,
  label,
  control,
  desc,
}: {
  htmlFor?: string;
  label: string;
  control: ReactNode;
  desc?: string;
}) {
  return (
    <div className="settings-row">
      <label className="settings-row-label" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="settings-row-control">{control}</div>
      {desc !== undefined ? <p className="settings-row-desc">{desc}</p> : null}
    </div>
  );
}

/** 参数行集合：只列本应用真实存在的设置项。 */
function ParameterRows() {
  const { t } = useTranslation();
  const sensitivity = useUiStore((state) => state.sensitivity);
  const setSensitivity = useUiStore((state) => state.setSensitivity);
  const fov = useUiStore((state) => state.fov);
  const setFov = useUiStore((state) => state.setFov);
  const renderDistance = useUiStore((state) => state.renderDistance);
  const setRenderDistance = useUiStore((state) => state.setRenderDistance);
  const quality = useUiStore((state) => state.quality);
  const setQuality = useUiStore((state) => state.setQuality);
  const antialias = useUiStore((state) => state.antialias);
  const setAntialias = useUiStore((state) => state.setAntialias);
  const frameLimit = useUiStore((state) => state.frameLimit);
  const setFrameLimit = useUiStore((state) => state.setFrameLimit);
  const language = useUiStore((state) => state.language);
  const setLanguage = useUiStore((state) => state.setLanguage);
  const requestRespawn = useUiStore((state) => state.requestRespawn);
  const airJump = useUiStore((state) => state.airJump);
  const setAirJump = useUiStore((state) => state.setAirJump);
  const volume = useUiStore((state) => state.volume);
  const setVolume = useUiStore((state) => state.setVolume);
  const ambientMotes = useUiStore((state) => state.ambientMotes);
  const setAmbientMotes = useUiStore((state) => state.setAmbientMotes);
  const [fullscreen, setFullscreenState] = useState(() =>
    typeof document === "undefined" ? false : Boolean(document.fullscreenElement),
  );

  // 跟随系统全屏状态（F11 / 浏览器控件也能改变）。
  useEffect(() => {
    const sync = () => setFullscreenState(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const handleLanguageChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    if (SUPPORTED_LANGUAGES.includes(next as Language)) {
      setLanguage(next as Language);
    }
  };

  return (
    <>
      <SettingRow
        htmlFor="settings-sensitivity"
        label={t("settings.sensitivity")}
        desc={t("settings.sensitivityDesc")}
        control={
          <>
            <input
              id="settings-sensitivity"
              type="range"
              min={SENSITIVITY_RANGE[0]}
              max={SENSITIVITY_RANGE[1]}
              step={0.05}
              value={sensitivity}
              onChange={(event) => setSensitivity(Number(event.target.value))}
            />
            <span className="settings-slider-value">{sensitivity.toFixed(2)}</span>
          </>
        }
      />
      <SettingRow
        htmlFor="settings-fov"
        label={t("settings.fov")}
        desc={t("settings.fovDesc")}
        control={
          <>
            <input
              id="settings-fov"
              type="range"
              min={FOV_RANGE[0]}
              max={FOV_RANGE[1]}
              step={1}
              value={Math.round(fov)}
              onChange={(event) => setFov(Number(event.target.value))}
            />
            <span className="settings-slider-value">{Math.round(fov)}°</span>
          </>
        }
      />
      <SettingRow
        htmlFor="settings-render-distance"
        label={t("settings.renderDistance")}
        desc={t("settings.renderDistanceDesc")}
        control={
          <>
            <input
              id="settings-render-distance"
              type="range"
              min={RENDER_DISTANCE_RANGE[0]}
              max={RENDER_DISTANCE_RANGE[1]}
              step={10}
              value={Math.round(renderDistance)}
              onChange={(event) => setRenderDistance(Number(event.target.value))}
            />
            <span className="settings-slider-value">{Math.round(renderDistance)}</span>
          </>
        }
      />
      <SettingRow
        htmlFor="settings-air-jump"
        label={t("settings.airJump")}
        desc={t("settings.airJumpHint")}
        control={
          <button
            id="settings-air-jump"
            type="button"
            role="switch"
            aria-checked={airJump}
            className={airJump ? "settings-switch on" : "settings-switch"}
            onClick={() => setAirJump(!airJump)}
          >
            {airJump ? t("settings.on") : t("settings.off")}
          </button>
        }
      />
      <SettingRow
        htmlFor="settings-quality"
        label={t("settings.quality")}
        desc={t("settings.qualityHint")}
        control={
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
        }
      />
      <SettingRow
        htmlFor="settings-antialias"
        label={t("settings.antialias")}
        desc={t("settings.antialiasHint")}
        control={
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
        }
      />
      <SettingRow
        htmlFor="settings-frame-limit"
        label={t("settings.frameLimit")}
        control={
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
        }
      />
      <SettingRow
        htmlFor="settings-fullscreen"
        label={t("settings.fullscreen")}
        desc={t("settings.fullscreenHint")}
        control={
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
        }
      />
      <SettingRow
        htmlFor="settings-language"
        label={t("settings.language")}
        control={
          <select id="settings-language" value={language} onChange={handleLanguageChange}>
            {SUPPORTED_LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_LABELS[code]}
              </option>
            ))}
          </select>
        }
      />
      <SettingRow
        htmlFor="settings-respawn"
        label={t("settings.respawn")}
        control={
          <button
            id="settings-respawn"
            type="button"
            className="settings-action"
            onClick={requestRespawn}
          >
            {t("settings.respawnAction")}
          </button>
        }
      />
      <SettingRow
        htmlFor="settings-volume"
        label={t("settings.volume")}
        desc={t("settings.volumeHint")}
        control={
          <>
            <input
              id="settings-volume"
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(volume)}
              onChange={(event) => setVolume(Number(event.target.value))}
            />
            <span className="settings-slider-value">{Math.round(volume)}%</span>
          </>
        }
      />
      <SettingRow
        htmlFor="settings-ambient-motes"
        label={t("settings.ambientMotes")}
        desc={t("settings.ambientMotesHint")}
        control={
          <button
            id="settings-ambient-motes"
            type="button"
            role="switch"
            aria-checked={ambientMotes}
            className={ambientMotes ? "settings-switch on" : "settings-switch"}
            onClick={() => setAmbientMotes(!ambientMotes)}
          >
            {ambientMotes ? t("settings.on") : t("settings.off")}
          </button>
        }
      />
    </>
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

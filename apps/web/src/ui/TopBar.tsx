import type { ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, type Language } from "@/i18n";
import { useFloorStore } from "@/state/floorStore";
import { useUiStore } from "@/state/uiStore";
import { useViewStore } from "@/state/viewStore";
import { MapSwitcher } from "./MapSwitcher";

export function TopBar() {
  const { t } = useTranslation();
  const floor = useFloorStore((state) => state.floor);
  const floorOptions = useFloorStore((state) => state.floorOptions);
  const setFloor = useFloorStore((state) => state.setFloor);
  const view = useViewStore((state) => state.view);
  const setView = useViewStore((state) => state.setView);
  const language = useUiStore((state) => state.language);
  const setLanguage = useUiStore((state) => state.setLanguage);
  const bigmapOpen = useUiStore((state) => state.bigmapOpen);
  const setBigmapOpen = useUiStore((state) => state.setBigmapOpen);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);

  const handleFloorChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setFloor(Number(event.target.value));
  };

  const handleLanguageChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    if ((SUPPORTED_LANGUAGES as readonly string[]).includes(next)) {
      setLanguage(next as Language);
    }
  };

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="topbar-title">{t("app.title")}</span>
        <span className="topbar-tagline">{t("app.tagline")}</span>
      </div>

      <MapSwitcher />

      <label className="topbar-field">
        <span>{t("toolbar.floorSelect")}</span>
        <select value={floor} onChange={handleFloorChange}>
          {floorOptions.map((value) => (
            <option key={value} value={value}>
              {value < 0
                ? t("floor.basement", { floor: Math.abs(value) })
                : t("floor.floorName", { floor: value })}
            </option>
          ))}
        </select>
      </label>

      <div className="topbar-actions">
        {/* 2D/3D 沙盘分段切换：原地交换主视图（3D 场景保持挂载），楼层/搜索/粗类筛选双视图联动。 */}
        <div className="view-switch" role="tablist" aria-label={t("toolbar.viewSwitch")}>
          <button
            type="button"
            role="tab"
            aria-selected={view === "2d"}
            className={view === "2d" ? "view-switch-button active" : "view-switch-button"}
            onClick={() => setView("2d")}
          >
            {t("toolbar.view2d")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "3d"}
            className={view === "3d" ? "view-switch-button active" : "view-switch-button"}
            onClick={() => setView("3d")}
          >
            {t("toolbar.view3d")}
          </button>
        </div>
        {view === "3d" ? (
          <button
            type="button"
            className={bigmapOpen ? "topbar-button active" : "topbar-button"}
            onClick={() => setBigmapOpen(!bigmapOpen)}
          >
            {bigmapOpen ? t("toolbar.closeBigmap") : t("toolbar.openBigmap")}
          </button>
        ) : null}
        <select
          className="topbar-language"
          value={language}
          onChange={handleLanguageChange}
          aria-label={t("toolbar.language")}
        >
          {SUPPORTED_LANGUAGES.map((code) => (
            <option key={code} value={code}>
              {LANGUAGE_LABELS[code]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="topbar-button"
          onClick={() => setSettingsOpen(true)}
          aria-label={t("settings.title")}
        >
          ⚙
        </button>
      </div>
    </header>
  );
}

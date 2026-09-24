import type { ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { useFloorStore } from "@/state/floorStore";
import { useUiStore } from "@/state/uiStore";
import { MapSwitcher } from "./MapSwitcher";

export function TopBar() {
  const { t } = useTranslation();
  const floor = useFloorStore((state) => state.floor);
  const floors = useFloorStore((state) => state.floors);
  const setFloor = useFloorStore((state) => state.setFloor);
  const language = useUiStore((state) => state.language);
  const setLanguage = useUiStore((state) => state.setLanguage);
  const bigmapOpen = useUiStore((state) => state.bigmapOpen);
  const setBigmapOpen = useUiStore((state) => state.setBigmapOpen);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);

  const handleFloorChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setFloor(Number(event.target.value));
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
          {floors.map((value) => (
            <option key={value} value={value}>
              {value < 0
                ? t("floor.basement", { floor: Math.abs(value) })
                : t("floor.floorName", { floor: value })}
            </option>
          ))}
        </select>
      </label>

      <div className="topbar-actions">
        <button
          type="button"
          className={bigmapOpen ? "topbar-button active" : "topbar-button"}
          onClick={() => setBigmapOpen(!bigmapOpen)}
        >
          {bigmapOpen ? t("toolbar.closeBigmap") : t("toolbar.openBigmap")}
        </button>
        <button
          type="button"
          className="topbar-button"
          onClick={() => setLanguage(language === "zh" ? "en" : "zh")}
          aria-label={t("toolbar.language")}
        >
          {language === "zh" ? "EN" : "中文"}
        </button>
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

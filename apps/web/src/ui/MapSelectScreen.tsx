import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, type Language } from "@/i18n";
import { MAPS } from "@/map";
import { useMapStore } from "@/state/mapStore";
import { useUiStore } from "@/state/uiStore";
import { useHomeStore } from "./homeStore";

/**
 * 选图屏（应用入口层）。
 *
 * 视觉口径对齐上游地图选择首屏：底 #0A0F13、地图卡行、
 * 「立即行动」CTA 300x84 绿底(#0EF293)黑字、操作提示白@0.698。
 * 结构性取舍：标题为本仓应用名（来源零提及）；不放「更多工具」外链
 * 与平台二维码（无真实对应物）；语言选择器占右上槽位（真实功能）。
 * 选图屏为覆盖层：壳与默认图照常加载，?map=<数字> 直进时挂载即关闭。
 */
export function MapSelectScreen() {
  const { t } = useTranslation();
  const homeOpen = useHomeStore((state) => state.homeOpen);
  const enter = useHomeStore((state) => state.enter);
  const consumeDeepLink = useHomeStore((state) => state.consumeDeepLink);
  const mapId = useMapStore((state) => state.mapId);
  const status = useMapStore((state) => state.status);
  const progress = useMapStore((state) => state.progress);
  const setMap = useMapStore((state) => state.setMap);
  const language = useUiStore((state) => state.language);
  const setLanguage = useUiStore((state) => state.setLanguage);

  // ?map=<MapId 数字> 直进（对齐上游直进参数：数字有效，挂载后即关闭选图屏）。
  useEffect(() => {
    consumeDeepLink();
  }, [consumeDeepLink]);

  if (!homeOpen) {
    return null;
  }

  const handleLanguageChange = (value: string) => {
    if ((SUPPORTED_LANGUAGES as readonly string[]).includes(value)) {
      setLanguage(value as Language);
    }
  };

  return (
    <div className="home-screen" role="dialog" aria-label={t("home.mapSelect")}>
      <header className="home-header">
        <div className="home-title-block">
          <h1 className="home-title">{t("app.title")}</h1>
          <p className="home-tagline">{t("app.tagline")}</p>
        </div>
        <select
          className="home-lang"
          value={language}
          onChange={(event) => handleLanguageChange(event.target.value)}
          aria-label={t("toolbar.language")}
        >
          {SUPPORTED_LANGUAGES.map((code) => (
            <option key={code} value={code}>
              {LANGUAGE_LABELS[code]}
            </option>
          ))}
        </select>
      </header>

      <div className="home-cards" role="tablist" aria-label={t("home.mapSelect")}>
        {MAPS.map((definition) => {
          const active = definition.id === mapId;
          const showStatus = active && status === "loading";
          return (
            <button
              key={definition.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`home-card${active ? " selected" : ""}`}
              onClick={() => {
                // 选卡即换图（数据包照常加载，立即行动后即刻就绪）。
                if (definition.id !== mapId) {
                  setMap(definition.id);
                }
              }}
            >
              <span className="home-card-id">{definition.id}</span>
              <h2 className="home-card-name">{t(definition.nameKey)}</h2>
              <p className="home-card-status">
                {showStatus
                  ? t("home.downloading", { percent: Math.round(progress * 100) })
                  : active && status === "error"
                    ? t("switcher.retry")
                    : ""}
              </p>
            </button>
          );
        })}
      </div>

      <footer className="home-footer">
        <p className="home-tip">{t("home.tip")}</p>
        {/* CTA 双态：所选图加载中显示「正在下载 N%」（原 SliderDownloadingProgress 口径）。 */}
        <button type="button" className="home-cta" onClick={enter}>
          {status === "loading"
            ? t("home.downloading", { percent: Math.round(progress * 100) })
            : t("home.cta")}
        </button>
      </footer>
    </div>
  );
}

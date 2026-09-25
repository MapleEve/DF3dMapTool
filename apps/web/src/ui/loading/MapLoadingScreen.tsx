import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getMapById } from "@/map";
import { useMapStore } from "@/state/mapStore";
import { SCENE_LOADING_TEXT, SCENE_TIPS, resolveLoadingLanguage } from "./loadingText";
import { useLoadingTips } from "./useLoadingTips";
import "./loading.css";

/** 设计基准宽高（--ui-scale 换算用，与 boot 屏同口径）。 */
const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;

/**
 * 进图加载屏：半透明黑遮罩盖在 3D 画布上——地图名（白 50px）、「加载中」（绿 32px）、
 * 大百分比（绿 180px）、底部 130px 提示条 + 全宽 17px 绿色进度滑条。
 * 百分比语义见 progressMapping（索引先行 + 分块聚合）；完成时由 LoadingFlow 硬切卸载。
 */
export function MapLoadingScreen({ percent }: { percent: number }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { t, i18n } = useTranslation();
  const language = resolveLoadingLanguage(i18n.language);
  const mapId = useMapStore((state) => state.mapId);
  const tipsConfig = SCENE_TIPS[language];
  const tip = useLoadingTips(tipsConfig);

  const definition = getMapById(mapId);
  const mapName = definition === undefined ? "" : t(definition.nameKey);

  // 设计基准缩放：锚点尺寸经 --ui-scale 换算（load/resize 重算）。
  useEffect(() => {
    const apply = () => {
      const root = rootRef.current;
      if (root === null) {
        return;
      }
      const scaleX = document.documentElement.clientWidth / DESIGN_WIDTH;
      const scaleY = document.documentElement.clientHeight / DESIGN_HEIGHT;
      root.style.setProperty("--ui-scale", String(Math.min(scaleX, scaleY)));
    };
    apply();
    window.addEventListener("load", apply);
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("load", apply);
      window.removeEventListener("resize", apply);
    };
  }, []);

  return (
    <div className="scene-loading" ref={rootRef} role="status">
      <div className="scene-loading-map-name">{mapName}</div>
      <div className="scene-loading-label">{SCENE_LOADING_TEXT[language]}</div>
      <div className="scene-loading-percent">{percent}%</div>
      <div className="scene-loading-bar">
        <div className="scene-loading-tip">{tip.text}</div>
      </div>
      <div className="scene-loading-slider">
        <div className="scene-loading-slider-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

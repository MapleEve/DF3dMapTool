import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getMapById } from "@/map";
import { useMapStore } from "@/state/mapStore";
import {
  SCENE_LOADING_TEXT,
  SCENE_TIPS,
  bootLogoUrl,
  resolveLoadingLanguage,
  type LoadingLanguage,
} from "./loadingText";
import { useLoadingTips } from "./useLoadingTips";
import "./loading.css";

/** 设计基准宽高（--ui-scale 换算用，与 boot 屏同口径）。 */
const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;

/** 进图屏 slogan 素材（641x282，随加载文案语言；自建矢量素材，文案为应用自身口径）。 */
function sceneSloganUrl(language: LoadingLanguage): string {
  return `/assets/loading/scene-slogan-${language}.svg`;
}

export interface MapLoadingScreenProps {
  /** 呈现进度（索引阶段 0-30 + 分块阶段 30-100，见 progressMapping）。 */
  readonly percent: number;
  /** 是否处于下载态（索引容器拉取中：进度区呈现 logo+slogan 素材图与「正在下载 N%」）。 */
  readonly downloading: boolean;
  /** 下载态的原始索引下载进度（整数百分数；仅 downloading 时消费）。 */
  readonly downloadPercent: number;
}

/**
 * 进图加载屏：半透明黑遮罩盖在 3D 画布上——地图名（白 50px）、「加载中」（绿 32px）、
 * 底部 130px 提示条 + 全宽 17px 绿色进度滑条。
 * 进度区两态（上游换图加载的两段语义；换图拉取素材时同步取 logo/slogan 两张图）：
 * - 下载态（索引容器下载中）：logo 字标（768x120，顶部居中，zh/tw 中文版 / en/ru 英文版）
 *   + slogan（641x282，进度区居中）+「正在下载 N%」（绿 32px）；位置为应用侧界定
 *   （上游该态无实测构图，按 768x120 顶部 + 641x282 进度区居中排布）；
 * - 流式态（分块加载中）：大百分比（绿 180px），与实测流式帧构图一致（该态无 logo/slogan）。
 * 两态与完成均硬切；百分比语义见 progressMapping（索引先行 + 分块聚合）。
 */
export function MapLoadingScreen({ percent, downloading, downloadPercent }: MapLoadingScreenProps) {
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
      {downloading ? (
        <>
          <img
            className="scene-loading-logo"
            src={bootLogoUrl(language)}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
          <img
            className="scene-loading-slogan"
            src={sceneSloganUrl(language)}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
          <div className="scene-loading-downloading">
            {t("home.downloading", { percent: downloadPercent })}
          </div>
        </>
      ) : (
        <div className="scene-loading-percent">{percent}%</div>
      )}
      <div className="scene-loading-bar">
        <div className="scene-loading-tip">{tip.text}</div>
      </div>
      <div className="scene-loading-slider">
        <div className="scene-loading-slider-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

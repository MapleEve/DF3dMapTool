import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { AnimationItem } from "lottie-web";
import { BOOT_LOADING_TEXT, BOOT_TIPS, bootLogoUrl, resolveLoadingLanguage } from "./loadingText";
import { useLoadingTips } from "./useLoadingTips";
import "./loading.css";

/** 设计基准宽高（#loading-cover 整体缩放用）。 */
const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;

/**
 * 启动加载屏：全屏渐变底 + logo + lottie 循环动画 + 「加载中...」+ 提示轮换。
 * 结构/类名/ID/字号/色值按实测复刻；无任何进度条（原站口径）。
 * 覆盖整个应用壳，首帧即显示；由 LoadingFlow 在启动加载完成时卸载（硬切）。
 */
export function BootLoadingScreen() {
  const coverRef = useRef<HTMLDivElement>(null);
  const lottieContainerRef = useRef<HTMLDivElement>(null);
  const { i18n } = useTranslation();
  const language = resolveLoadingLanguage(i18n.language);
  const tipsConfig = BOOT_TIPS[language];
  const tip = useLoadingTips(tipsConfig);

  // lottie 循环动画：svg 渲染器 + loop + autoplay（动态加载播放器，不进主包）。
  // 播放器用 light 构建（仅 svg 渲染器、无表达式求值器）：动画为纯形状合成，
  // 无表达式依赖；light 构建不含直接 eval，构建告警为零，体积也更小。
  useEffect(() => {
    let cancelled = false;
    let animation: AnimationItem | null = null;
    void import("lottie-web/build/player/lottie_light.js").then(({ default: lottie }) => {
      const container = lottieContainerRef.current;
      if (cancelled || container === null) {
        return;
      }
      animation = lottie.loadAnimation({
        container,
        renderer: "svg",
        loop: true,
        autoplay: true,
        path: "/assets/loading/anim.json",
      });
    });
    return () => {
      cancelled = true;
      animation?.destroy();
      animation = null;
    };
  }, []);

  // 设计基准缩放：cover 整体 scale(min(vw/1920, vh/1080))，load/resize 重算。
  useEffect(() => {
    const apply = () => {
      const cover = coverRef.current;
      if (cover === null) {
        return;
      }
      const scaleX = document.documentElement.clientWidth / DESIGN_WIDTH;
      const scaleY = document.documentElement.clientHeight / DESIGN_HEIGHT;
      cover.style.transform = `scale(${Math.min(scaleX, scaleY)})`;
    };
    apply();
    window.addEventListener("load", apply);
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("load", apply);
      window.removeEventListener("resize", apply);
    };
  }, []);

  const logoUrl = useMemo(() => bootLogoUrl(language), [language]);
  const loadingText = BOOT_LOADING_TEXT[language];

  return (
    <div className="loading-bg" id="loading-container">
      <div id="loading-cover" ref={coverRef}>
        <div className="lottie-container" id="lottie-container" ref={lottieContainerRef} />
        <div className="loading-text" id="loading-text">
          {loadingText}
        </div>
        <div className="loading-tip-wrapper">
          <img className="loading-tip-bg" src="/assets/loading/loading-tip-bg.svg" alt="" />
          <div className={tip.hidden ? "loading-tip hidden" : "loading-tip"} id="tip-text">
            {tip.text}
          </div>
        </div>
        <div className="logo">
          <img src={logoUrl} id="loading-logo" alt="DF3dMapTool" />
        </div>
      </div>
    </div>
  );
}

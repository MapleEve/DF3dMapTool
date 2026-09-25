import { useEffect, useState } from "react";
import { createTipRotator } from "./tipRotator";
import type { LoadingTipsConfig } from "./loadingText";

export interface LoadingTipView {
  /** 当前提示文案（无提示时为空串）。 */
  readonly text: string;
  /** 是否处于切换窗口（对应 .hidden 类；类本身无样式，硬切换）。 */
  readonly hidden: boolean;
}

/**
 * 挂载即开始轮换的提示订阅：config 变化（语言切换）时重开一轮（首条立即显示）。
 * 文案/hidden 均来自轮换器回调；空提示集时轮换器不排程、不回调，保持初始空文案。
 */
export function useLoadingTips(config: LoadingTipsConfig): LoadingTipView {
  const [view, setView] = useState<LoadingTipView>(() => ({
    text: config.tips[0] ?? "",
    hidden: false,
  }));

  useEffect(() => {
    const rotator = createTipRotator({
      tips: config.tips,
      intervalMs: config.interval,
      animMs: config.anim,
      onText: (text) => {
        setView({ text, hidden: false });
      },
      onHiddenChange: (hidden) => {
        setView((prev) => (prev.hidden === hidden ? prev : { ...prev, hidden }));
      },
    });
    rotator.start();
    return () => {
      rotator.stop();
    };
  }, [config]);

  return view;
}

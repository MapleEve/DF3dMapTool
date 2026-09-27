import { useEffect, useState } from "react";
import {
  RESPAWN_COVER_END_PERCENT,
  RESPAWN_COVER_MS,
  RESPAWN_COVER_START_PERCENT,
} from "../respawn";
import { MapLoadingScreen } from "./MapLoadingScreen";

/** 遮罩内百分比刷新节拍（毫秒）。 */
const TICK_MS = 100;

/**
 * 回出生点加载遮罩：进图屏同款（地图名 +「加载中」+ 大百分比 + tip + 滑条），
 * 百分比自起始值爬升至 99 后由流程侧定时硬切卸载（遮罩期间相机已传送就位）。
 */
export function RespawnCover() {
  const [percent, setPercent] = useState(RESPAWN_COVER_START_PERCENT);

  useEffect(() => {
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      const fraction = Math.min(1, (performance.now() - startedAt) / RESPAWN_COVER_MS);
      setPercent(
        Math.round(
          RESPAWN_COVER_START_PERCENT +
            (RESPAWN_COVER_END_PERCENT - RESPAWN_COVER_START_PERCENT) * fraction,
        ),
      );
    }, TICK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  return <MapLoadingScreen percent={percent} downloading={false} downloadPercent={0} />;
}

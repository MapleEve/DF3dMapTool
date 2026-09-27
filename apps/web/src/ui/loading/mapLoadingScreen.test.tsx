import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { initI18n } from "@/i18n";
import { MapLoadingScreen } from "./MapLoadingScreen";

/**
 * 进图加载屏进度区两态（#54/L-scene-load）：
 * - 下载态：logo（768x120 素材位）+ slogan（641x282 素材位）+「正在下载 N%」；
 * - 流式态：大百分比（实测构图，无 logo/slogan）。
 * SSR 渲染冒烟（zustand 建库初始态：默认地图/中文文案）。
 */
describe("MapLoadingScreen 进度区两态", () => {
  it("下载态：logo+slogan 素材图与「正在下载 N%」，无大百分比", async () => {
    await initI18n();
    const html = renderToString(<MapLoadingScreen percent={12} downloading downloadPercent={42} />);
    expect(html).toContain("scene-loading-logo");
    expect(html).toContain("/assets/loading/logo-zh.svg");
    expect(html).toContain("scene-loading-slogan");
    expect(html).toContain("/assets/loading/scene-slogan-zh.svg");
    expect(html).toContain("正在下载 42%");
    expect(html).not.toContain("scene-loading-percent");
    // 常驻元素仍在：地图名/「加载中」标签/底部提示条/滑条。
    expect(html).toContain("scene-loading-map-name");
    expect(html).toContain("加载中");
    expect(html).toContain("scene-loading-bar");
    expect(html).toContain("scene-loading-slider");
  });

  it("流式态：大百分比，无下载态素材图", async () => {
    await initI18n();
    const html = renderToString(
      <MapLoadingScreen percent={87} downloading={false} downloadPercent={100} />,
    );
    expect(html).toContain("scene-loading-percent");
    expect(html).toContain("87%");
    expect(html).not.toContain("scene-loading-logo");
    expect(html).not.toContain("scene-loading-slogan");
    expect(html).not.toContain("正在下载");
  });
});

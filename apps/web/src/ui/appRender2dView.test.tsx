import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { initI18n } from "@/i18n";
import { Sandbox2dView } from "@/sandbox2d";
import { MapViewport } from "./MapViewport";

/**
 * 2D 沙盘视图的渲染冒烟（运行器无关：不依赖建库初始态）。
 * zustand 在 SSR 下读取 getInitialState()，setState 不影响 SSR 输出，
 * 故 App 级「view==='2d' 分支」拆成两侧分别验证：
 * - MapViewport hidden 属性（App 在 2D 视图下的传值）→ 隐藏类名；
 * - Sandbox2dView（App 在 2D 视图下挂载的组件）→ 自身渲染。
 * 视图模式的切换/持久化状态机由 state/viewStore.test.ts 覆盖。
 */
describe("2D 沙盘视图渲染", () => {
  it("MapViewport hidden：3D 视口保持挂载但带隐藏标记（display:none 由样式承担）", () => {
    const html = renderToString(<MapViewport hidden />);
    expect(html).toContain("map-viewport hidden");
    expect(html).toContain("map-canvas");
  });

  it("MapViewport 默认（3D 视图）：无隐藏标记", () => {
    const html = renderToString(<MapViewport />);
    expect(html).toContain('class="map-viewport"');
    expect(html).not.toContain("map-viewport hidden");
  });

  it("Sandbox2dView：全页视图容器挂载", async () => {
    await initI18n();
    const html = renderToString(<Sandbox2dView />);
    expect(html).toContain("sandbox2d-view");
    expect(html).toContain("数据包准备中");
  });
});

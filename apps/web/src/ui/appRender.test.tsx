import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import App from "@/App";
import { initI18n } from "@/i18n";

/**
 * 应用外壳渲染冒烟：SSR 渲染整棵 UI 树（视口的动态引擎导入不在此触发），
 * 用于捕获组件树的导入错误与渲染期异常。
 * 注：zustand 在 SSR 下读取建库初始态，故这里只断言初始渲染
 * （2D 视图初始态的渲染冒烟在 appRender2dView.test.tsx，经持久化桩单独建库）。
 */
describe("App 外壳渲染", () => {
  it("渲染顶栏/侧栏/状态栏关键节点与 6 个图位", async () => {
    await initI18n();
    const html = renderToString(<App />);
    expect(html).toContain("DF3dMapTool");
    expect(html).toContain("兴趣点");
    expect(html).toContain("大地图");
    expect(html).toContain("零号大坝");
    expect(html).toContain("巴克什");
    expect(html).toContain("长弓溪谷");
    expect(html).toContain("潮汐监狱");
    expect(html).toContain("航天基地");
    expect(html).toContain("截图");
    // 默认关闭的面板/覆盖层不渲染。
    expect(html).not.toContain("画质");
    expect(html).not.toContain("俯视地图");
  });

  it("3D 视图（默认）：分段切换控件常驻，3D 视口无隐藏标记", async () => {
    await initI18n();
    const html = renderToString(<App />);
    expect(html).toContain("2D 沙盘");
    expect(html).toContain("3D 沙盘");
    expect(html).toContain("沙盘视图切换");
    expect(html).toContain('class="map-viewport"');
    expect(html).not.toContain("map-viewport hidden");
    expect(html).toContain("大地图 (M)");
  });
});

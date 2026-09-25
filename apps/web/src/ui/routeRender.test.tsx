import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { initI18n, changeLanguage } from "@/i18n";
import type { RouteMarker } from "@/data/routes";
import type { RuntimeRoute } from "@/state/routeStore";
import { RouteHud, RouteHudContent } from "./RouteHud";
import { RouteListView, RouteDetailView } from "./RoutePanel";
import { RecordPanelView, RouteSaveDialog } from "./RouteRecording";
import { CollectionPanel } from "./CollectionPanel";
import type { InteractTarget } from "@/state/interactStore";

/**
 * 路线/收藏 UI 渲染冒烟：SSR 渲染组件树捕获导入错误与渲染期异常。
 * 注：zustand 在 SSR 下读取 getInitialState()（setState 不影响 SSR 输出），
 * 受控内容组件（RouteListView/RouteHudContent/RecordPanelView 等）以 props
 * 驱动断言；外壳开关（RoutePanel/CollectionPanel 初始关闭）由 store 测试覆盖。
 * 文案断言校验四语言键位与上游文案的接线（热门路线/开始导航等逐字一致）。
 */

function sampleRoute(overrides: Partial<RuntimeRoute> = {}): RuntimeRoute {
  return {
    id: "r1",
    name: "水泥厂出生快得吃免保路线",
    nameEn: "Cement Plant Spawn : Free Safe Rush",
    hotScore: 1,
    durationSeconds: 59,
    lengthMeters: 9374,
    pointCount: 3,
    points: new Float32Array(9),
    markers: [
      {
        name: "标注",
        nameEn: null,
        desc: "",
        descEn: "",
        pointIndex: 0,
        worldPos: { x: 0, y: 0, z: 0 },
        nearestDistance: 0,
      },
    ],
    custom: false,
    ...overrides,
  };
}

describe("路线系统 UI 渲染", () => {
  it("列表视图：标题 + 空态文案 + 自录入口（zh 上游文案）", async () => {
    await initI18n();
    const html = renderToString(<RouteListView routes={[]} status="ready" language="zh" />);
    expect(html).toContain("热门推荐线路");
    expect(html).toContain("鼠鼠努力更新中，敬请期待！");
    expect(html).toContain("录制模式");
    expect(html).toContain("导入");
  });

  it("列表行：名称 + 米数/时长/标记数（两位补零）+ 开始导航按钮", async () => {
    await initI18n();
    const html = renderToString(
      <RouteListView routes={[sampleRoute()]} status="ready" language="zh" />,
    );
    expect(html).toContain("水泥厂出生快得吃免保路线");
    expect(html).toContain("9374m");
    expect(html).toContain("00:59");
    expect(html).toContain("01");
    expect(html).toContain("开始导航");
  });

  it("列表行（en）：数据内英文名接线", async () => {
    await initI18n();
    await changeLanguage("en");
    const html = renderToString(
      <RouteListView routes={[sampleRoute()]} status="ready" language="en" />,
    );
    expect(html).toContain("Cement Plant Spawn : Free Safe Rush");
    expect(html).toContain("Start Navigation");
    await changeLanguage("zh");
  });

  it("自录行：导出/删除工具呈现", async () => {
    await initI18n();
    const custom = sampleRoute({ id: "user_1", custom: true });
    const html = renderToString(<RouteListView routes={[custom]} status="ready" language="zh" />);
    expect(html).toContain("导出");
    expect(html).toContain("删除");
  });

  it("详情视图：返回/标注点/传送 + 开始导航（受控 props）", async () => {
    await initI18n();
    const html = renderToString(
      <RouteDetailView language="zh" route={sampleRoute()} following={false} />,
    );
    expect(html).toContain("返回路线列表");
    expect(html).toContain("标注");
    expect(html).toContain("传送");
    expect(html).toContain("开始导航");
    // 跟跑中按钮切换为结束导航（黑字绿底形态）
    const htmlFollowing = renderToString(
      <RouteDetailView language="zh" route={sampleRoute()} following={true} />,
    );
    expect(htmlFollowing).toContain("结束导航");
  });

  it("HUD 初始态：Q 提示（RouteHud 默认渲染）", async () => {
    await initI18n();
    const html = renderToString(<RouteHud />);
    expect(html).toContain("显示线路面板");
    expect(html).not.toContain("长按结束导航");
  });

  it("HUD 受控形态：跟跑提示 + 途经标注 + F 键交互提示", async () => {
    await initI18n();
    const marker: RouteMarker = {
      name: "注意左边",
      nameEn: null,
      desc: "门口有人",
      descEn: "",
      pointIndex: 1,
      worldPos: { x: 0, y: 0, z: 0 },
      nearestDistance: 0,
    };
    const nearby: InteractTarget = {
      kind: "ladder",
      distance: 1,
      interactor: {
        kind: "ladder",
        index: 0,
        point: { x: 0, y: 0, z: 0 },
        distance: 1,
        radius: 3,
        target: { x: 0, y: 10, z: 0 },
        slideSpeed: 0,
      },
    };
    const html = renderToString(
      <RouteHudContent
        panelOpen={false}
        followActive={true}
        activeMarker={marker}
        nearby={nearby}
      />,
    );
    expect(html).toContain("长按结束导航");
    expect(html).toContain("注意左边");
    expect(html).toContain("门口有人");
    expect(html).toContain("梯子");
    expect(html).toContain("使用");
    expect(html).toContain("F");
  });

  it("HUD 受控形态：物资 POI 提示（类型名=POI 名）", async () => {
    await initI18n();
    const html = renderToString(
      <RouteHudContent
        panelOpen={false}
        followActive={false}
        activeMarker={null}
        nearby={{ kind: "poi", distance: 2, poiId: "p1", poiName: "保险柜" }}
      />,
    );
    expect(html).toContain("保险柜");
    expect(html).toContain("使用");
  });

  it("录制面板：状态行/警告/操作提示/结束（受控 props）", async () => {
    await initI18n();
    const html = renderToString(
      <RecordPanelView
        record={{
          startedAt: Date.now() - 65000,
          points: [
            { x: 0, y: 0, z: 0 },
            { x: 12, y: 0, z: 0 },
          ],
          markers: [{ name: "标注一", worldPos: { x: 6, y: 0, z: 0 } }],
        }}
        elapsed={65}
        onStop={() => {}}
      />,
    );
    expect(html).toContain("录制中");
    expect(html).toContain("标记点数量：1");
    expect(html).toContain("路径点数量：2");
    expect(html).toContain("距离：12m");
    expect(html).toContain("警告");
    expect(html).toContain("操作提示");
    expect(html).toContain("输入标注名称");
  });

  it("保存对话框：标题/占位文案/保存/取消(点2次)", async () => {
    await initI18n();
    const html = renderToString(
      <RouteSaveDialog
        draft={{
          id: "user_1",
          name: "",
          description: "",
          durationSeconds: 65,
          lengthMeters: 12,
          recordedAt: "2026-09-25T00:00:00.000Z",
          points: [
            { x: 0, y: 0, z: 0 },
            { x: 12, y: 0, z: 0 },
          ],
          markers: [],
        }}
        onDone={() => {}}
      />,
    );
    expect(html).toContain("保存路线");
    expect(html).toContain("路线名");
    expect(html).toContain("路线描述");
    expect(html).toContain("保存");
    expect(html).toContain("取消(点2次)");
  });

  it("物资面板外壳：初始关闭不渲染", async () => {
    await initI18n();
    const html = renderToString(<CollectionPanel />);
    expect(html).toBe("");
  });

  it("四语言键位接线（en）：列表/收藏文案", async () => {
    await initI18n();
    await changeLanguage("en");
    const html = renderToString(<RouteListView routes={[]} status="ready" language="en" />);
    expect(html).toContain("Popular Recommended Routes");
    expect(html).toContain("Updates are underway. Stay tuned!");
    const hud = renderToString(
      <RouteHudContent panelOpen={false} followActive={true} activeMarker={null} nearby={null} />,
    );
    expect(hud).toContain("Hold to End Navigation");
    await changeLanguage("zh");
  });
});

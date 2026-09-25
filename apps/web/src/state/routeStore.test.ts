import { beforeEach, describe, expect, it } from "vitest";
import { stubGlobal } from "@/testing/globals";

// node 测试环境无 localStorage：先装桩再装载 store（每个测试文件独立模块图）
const storage = new Map<string, string>();
stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
});

import type { StoredCustomRoute } from "./routeStore";

const {
  useRouteStore,
  polylineLength,
  customRouteToExport,
  customRouteFromExport,
  CUSTOM_ROUTES_STORAGE_KEY,
  readStoredCustomRoutes,
} = await import("./routeStore");

function sampleRoute(overrides: Partial<StoredCustomRoute> = {}): StoredCustomRoute {
  return {
    id: "user_1",
    name: "测试路线",
    description: "",
    durationSeconds: 10,
    lengthMeters: 30,
    recordedAt: "2026-09-25T00:00:00.000Z",
    points: [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 0, z: -20 },
    ],
    markers: [{ name: "标注一", worldPos: { x: 5, y: 0, z: 0 } }],
    ...overrides,
  };
}

describe("路线 store（自录持久化/导出导入）", () => {
  beforeEach(() => {
    storage.clear();
    useRouteStore.getState().reset();
  });

  it("polylineLength 计算折线总长", () => {
    expect(polylineLength([])).toBe(0);
    expect(
      polylineLength([
        { x: 0, y: 0, z: 0 },
        { x: 3, y: 4, z: 0 },
      ]),
    ).toBe(5);
    expect(
      polylineLength([
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 10, y: 0, z: -10 },
      ]),
    ).toBeCloseTo(20, 6);
  });

  it("导出/导入往返保持结构", () => {
    const route = sampleRoute();
    const text = customRouteToExport(route);
    const parsed = JSON.parse(text) as { format: string };
    expect(parsed.format).toBe("df3d-route-user/1");
    const back = customRouteFromExport(text);
    expect(back).toEqual(route);
  });

  it("导入格式校验：非法格式/非法 JSON 抛错", () => {
    expect(() => customRouteFromExport("not json")).toThrow();
    expect(() => customRouteFromExport('{"format":"other","route":{}}')).toThrow();
    expect(() =>
      customRouteFromExport('{"format":"df3d-route-user/1","route":{"id":1}}'),
    ).toThrow();
  });

  it("保存自录路线写入 localStorage 并进入运行时列表", () => {
    const store = useRouteStore.getState();
    useRouteStore.setState({ mapCode: "damiris" });
    store.saveCustomRoute("我的路线", "描述", sampleRoute());
    const stored = readStoredCustomRoutes().damiris ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("我的路线");
    expect(useRouteStore.getState().custom).toHaveLength(1);
    expect(useRouteStore.getState().custom[0].custom).toBe(true);
    expect(useRouteStore.getState().custom[0].pointCount).toBe(3);
  });

  it("删除自录路线同步移除存储", () => {
    useRouteStore.setState({ mapCode: "damiris" });
    const store = useRouteStore.getState();
    store.saveCustomRoute("我的路线", "", sampleRoute());
    store.deleteCustomRoute("user_1");
    expect(readStoredCustomRoutes().damiris).toHaveLength(0);
    expect(useRouteStore.getState().custom).toHaveLength(0);
  });

  it("导入自录路线按 id 去重合并", () => {
    useRouteStore.setState({ mapCode: "damiris" });
    const store = useRouteStore.getState();
    store.saveCustomRoute("旧名", "", sampleRoute());
    store.importCustomRoute(sampleRoute({ name: "新名" }));
    const stored = readStoredCustomRoutes().damiris ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("新名");
  });

  it("存储解析失败回退空表（脏数据容忍）", () => {
    storage.set(CUSTOM_ROUTES_STORAGE_KEY, "{broken json");
    expect(readStoredCustomRoutes()).toEqual({});
  });

  it("跟跑进度上报：途经标注点成为当前提示", () => {
    useRouteStore.setState({
      builtin: [
        {
          id: "r1",
          name: "路线",
          nameEn: null,
          hotScore: 1,
          durationSeconds: 30,
          lengthMeters: 100,
          pointCount: 10,
          points: new Float32Array(30),
          markers: [
            {
              name: "起点标注",
              nameEn: null,
              desc: "",
              descEn: "",
              pointIndex: 0,
              worldPos: { x: 0, y: 0, z: 0 },
              nearestDistance: 0,
            },
            {
              name: "中段标注",
              nameEn: null,
              desc: "",
              descEn: "",
              pointIndex: 5,
              worldPos: { x: 1, y: 0, z: 1 },
              nearestDistance: 0,
            },
          ],
          custom: false,
        },
      ],
    });
    const store = useRouteStore.getState();
    store.requestFollow("r1");
    store.reportFollowProgress("r1", 0.1, 1);
    expect(useRouteStore.getState().activeMarker?.name).toBe("起点标注");
    store.reportFollowProgress("r1", 0.6, 6);
    expect(useRouteStore.getState().activeMarker?.name).toBe("中段标注");
    store.finishFollow("r1");
    expect(useRouteStore.getState().followRouteId).toBeNull();
    expect(useRouteStore.getState().activeMarker).toBeNull();
  });

  it("录制会话：采样去重、标注添加、停止产出草稿", () => {
    const store = useRouteStore.getState();
    store.startRecord();
    store.pushRecordSample({ x: 0, y: 0, z: 0 });
    store.pushRecordSample({ x: 0, y: 0, z: 0 }); // 重复采样去重
    store.pushRecordSample({ x: 5, y: 0, z: 0 });
    store.addRecordMarker("  ", { x: 1, y: 0, z: 0 }); // 空名忽略
    store.addRecordMarker("标注", { x: 1, y: 0, z: 0 });
    const draft = store.stopRecord();
    expect(draft).not.toBeNull();
    expect(draft!.points).toHaveLength(2);
    expect(draft!.markers).toHaveLength(1);
    expect(draft!.lengthMeters).toBe(5);
    expect(useRouteStore.getState().record).toBeNull();
  });

  it("采样不足两点时不产出草稿", () => {
    const store = useRouteStore.getState();
    store.startRecord();
    store.pushRecordSample({ x: 0, y: 0, z: 0 });
    expect(store.stopRecord()).toBeNull();
  });
});

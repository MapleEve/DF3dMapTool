import { beforeEach, describe, expect, it } from "vitest";
import { useFloorStore } from "./floorStore";
import { useMapStore } from "./mapStore";
import { useMapDataStore } from "./mapDataStore";
import { usePoiFilterStore } from "./poiFilterStore";
import { usePoiStore } from "./poiStore";
import { useSearchStore } from "./searchStore";
import { useUiStore } from "./uiStore";

/** 截图执行器测试替身（需稳定引用以断言注册身份）。 */
const noopScreenshotHandler = () => undefined;

function resetStores(): void {
  useMapStore.setState({
    mapId: 106,
    status: "idle",
    errorCode: null,
    progress: 0,
    unavailableMapId: null,
  });
  useFloorStore.setState({ floors: [1], floor: 1 });
  usePoiFilterStore.setState({ hiddenCategories: [] });
  useSearchStore.setState({ query: "" });
  usePoiStore.setState({ selectedPoiId: null, flyToTarget: null });
  useUiStore.setState({
    sidebarOpen: true,
    bigmapOpen: false,
    settingsOpen: false,
    quality: "high",
    cameraHud: null,
    screenshotHandler: null,
  });
  useMapDataStore.setState({ mapId: null, bundle: null, poiData: null });
}

beforeEach(resetStores);

describe("mapStore 状态机", () => {
  it("idle → loading → ready，进度仅在 loading 态保留", () => {
    const store = useMapStore.getState();
    store.setStatus("loading");
    store.setProgress(0.42);
    expect(useMapStore.getState().status).toBe("loading");
    expect(useMapStore.getState().progress).toBeCloseTo(0.42);

    store.setStatus("ready");
    expect(useMapStore.getState().status).toBe("ready");
    expect(useMapStore.getState().progress).toBe(0);
    expect(useMapStore.getState().errorCode).toBeNull();
  });

  it("error 携带错误码；setMap 复位全部状态并清除“准备中”提示", () => {
    const store = useMapStore.getState();
    store.setStatus("error", "unavailable");
    expect(useMapStore.getState().errorCode).toBe("unavailable");

    store.setStatus("loading");
    store.notifyUnavailable(102);
    store.setProgress(0.5);
    store.setMap(101);
    const next = useMapStore.getState();
    expect(next.mapId).toBe(101);
    expect(next.status).toBe("idle");
    expect(next.errorCode).toBeNull();
    expect(next.progress).toBe(0);
    expect(next.unavailableMapId).toBeNull();
  });

  it("notifyUnavailable 记录与清除", () => {
    useMapStore.getState().notifyUnavailable(104);
    expect(useMapStore.getState().unavailableMapId).toBe(104);
    useMapStore.getState().notifyUnavailable(null);
    expect(useMapStore.getState().unavailableMapId).toBeNull();
  });
});

describe("floorStore", () => {
  it("applyFloors 设置楼层表与默认楼层", () => {
    useFloorStore.getState().applyFloors([-1, 1, 2], 1);
    expect(useFloorStore.getState().floors).toEqual([-1, 1, 2]);
    expect(useFloorStore.getState().floor).toBe(1);
  });

  it("setFloor 只改当前楼层", () => {
    useFloorStore.getState().applyFloors([1, 2, 3], 1);
    useFloorStore.getState().setFloor(3);
    expect(useFloorStore.getState().floor).toBe(3);
    expect(useFloorStore.getState().floors).toEqual([1, 2, 3]);
  });
});

describe("poiFilterStore", () => {
  it("toggleCategory 命中即隐藏、再点恢复", () => {
    usePoiFilterStore.getState().toggleCategory("supply");
    expect(usePoiFilterStore.getState().hiddenCategories).toEqual(["supply"]);
    usePoiFilterStore.getState().toggleCategory("supply");
    expect(usePoiFilterStore.getState().hiddenCategories).toEqual([]);
  });

  it("showAll / hideAll 批量切换", () => {
    usePoiFilterStore.getState().hideAllCategories();
    expect(usePoiFilterStore.getState().hiddenCategories).toHaveLength(6);
    usePoiFilterStore.getState().showAllCategories();
    expect(usePoiFilterStore.getState().hiddenCategories).toEqual([]);
  });
});

describe("searchStore", () => {
  it("setQuery 与 clearQuery", () => {
    useSearchStore.getState().setQuery("撤离");
    expect(useSearchStore.getState().query).toBe("撤离");
    useSearchStore.getState().clearQuery();
    expect(useSearchStore.getState().query).toBe("");
  });
});

describe("poiStore", () => {
  it("selectPoi 设置与清除选中", () => {
    usePoiStore.getState().selectPoi("1060206001");
    expect(usePoiStore.getState().selectedPoiId).toBe("1060206001");
    usePoiStore.getState().selectPoi(null);
    expect(usePoiStore.getState().selectedPoiId).toBeNull();
  });

  it("requestFlyTo 累增 token；consumeFlyTo 清空目标", () => {
    usePoiStore.getState().requestFlyTo({ x: 1, y: 2, z: 3 });
    const first = usePoiStore.getState().flyToTarget;
    expect(first?.position).toEqual({ x: 1, y: 2, z: 3 });

    usePoiStore.getState().requestFlyTo({ x: 4, y: 5, z: 6 });
    const second = usePoiStore.getState().flyToTarget;
    expect(second?.token).toBe((first?.token ?? 0) + 1);

    usePoiStore.getState().consumeFlyTo();
    expect(usePoiStore.getState().flyToTarget).toBeNull();
    // 对空目标重复消费是幂等的。
    usePoiStore.getState().consumeFlyTo();
    expect(usePoiStore.getState().flyToTarget).toBeNull();
  });
});

describe("uiStore", () => {
  it("侧栏/大地图/设置开关", () => {
    useUiStore.getState().toggleSidebar();
    expect(useUiStore.getState().sidebarOpen).toBe(false);
    useUiStore.getState().toggleBigmap();
    expect(useUiStore.getState().bigmapOpen).toBe(true);
    useUiStore.getState().setSettingsOpen(true);
    expect(useUiStore.getState().settingsOpen).toBe(true);
  });

  it("2D/3D 切换相机状态保持：大地图开合不触碰相机 HUD 与楼层", () => {
    // 大地图是 3D 常驻场景之上的覆盖层：开合不重置 3D 相机/楼层（位置记忆）。
    useUiStore.getState().setCameraHud({ position: { x: -1657.2, y: 40, z: -1859.3 }, yaw: 0.7 });
    useFloorStore.getState().applyFloors([1, 2, 3], 2);

    useUiStore.getState().toggleBigmap();
    expect(useUiStore.getState().bigmapOpen).toBe(true);
    expect(useUiStore.getState().cameraHud?.position).toEqual({ x: -1657.2, y: 40, z: -1859.3 });
    expect(useFloorStore.getState().floor).toBe(2);

    useUiStore.getState().toggleBigmap();
    expect(useUiStore.getState().bigmapOpen).toBe(false);
    expect(useUiStore.getState().cameraHud?.position).toEqual({ x: -1657.2, y: 40, z: -1859.3 });
    expect(useUiStore.getState().cameraHud?.yaw).toBeCloseTo(0.7, 9);
    expect(useFloorStore.getState().floor).toBe(2);
  });

  it("setLanguage 同步语言值并触发 i18next 切换", async () => {
    useUiStore.getState().setLanguage("en");
    expect(useUiStore.getState().language).toBe("en");
    useUiStore.getState().setLanguage("zh");
    expect(useUiStore.getState().language).toBe("zh");
  });

  it("setQuality 更新画质档位", () => {
    useUiStore.getState().setQuality("low");
    expect(useUiStore.getState().quality).toBe("low");
  });

  it("registerScreenshot 注册与注销截图执行器", () => {
    useUiStore.getState().registerScreenshot(noopScreenshotHandler);
    expect(useUiStore.getState().screenshotHandler).toBe(noopScreenshotHandler);
    useUiStore.getState().registerScreenshot(null);
    expect(useUiStore.getState().screenshotHandler).toBeNull();
  });

  it("setCameraHud 更新相机 HUD", () => {
    useUiStore.getState().setCameraHud({ position: { x: 1, y: 2, z: 3 }, yaw: 0.5 });
    expect(useUiStore.getState().cameraHud?.yaw).toBeCloseTo(0.5);
  });
});

describe("mapDataStore", () => {
  it("setMapData 与 clear", () => {
    const bundle = { definition: {}, manifest: {}, loader: {} };
    const poiData = { pois: [] };
    useMapDataStore.getState().setMapData(106, bundle as never, poiData as never);
    expect(useMapDataStore.getState().mapId).toBe(106);
    expect(useMapDataStore.getState().bundle).toBe(bundle);
    expect(useMapDataStore.getState().poiData).toBe(poiData);
    useMapDataStore.getState().clear();
    expect(useMapDataStore.getState().mapId).toBeNull();
    expect(useMapDataStore.getState().bundle).toBeNull();
  });
});

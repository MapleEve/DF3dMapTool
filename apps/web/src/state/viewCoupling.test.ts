import { beforeEach, describe, expect, it } from "vitest";
import type { MapPoiData } from "@/data";
import type { PoiCategory } from "@/poi/types";
import { useMapDataStore } from "./mapDataStore";
import { usePoiFilterStore } from "./poiFilterStore";
import {
  allGroupsVisible,
  applySandboxGroupsToPoiFilter,
  categoriesForGroup,
  couplingMapFromCategories,
  currentSandboxCoupling,
  groupsFromHiddenCategories,
  hiddenCategoriesFromGroups,
  sandboxGroupForCategory,
  useViewCoupling,
} from "./viewCoupling";

/**
 * 数据包派生分类夹具（各图 poi_type_config 的实测形态：TypeId 全图一致）：
 * t1 物资点 / t2 刷红点 / t3 首领boss / t5 钥匙房 / t6 出生点 / t7 撤离点 /
 * t8 地图信息 / t9 任务。
 */
const RUNTIME_CATEGORIES: readonly PoiCategory[] = [
  { id: "t1", label: "物资点", color: "#f5c542", order: 1 },
  { id: "t2", label: "刷红点", color: "#ff6b6b", order: 2 },
  { id: "t3", label: "首领boss", color: "#ff9f43", order: 3 },
  { id: "t5", label: "钥匙房", color: "#b58cff", order: 5 },
  { id: "t6", label: "出生点", color: "#8fa3b8", order: 6 },
  { id: "t7", label: "撤离点", color: "#39d98a", order: 7 },
  { id: "t8", label: "地图信息", color: "#5aa9ff", order: 8 },
  { id: "t9", label: "任务", color: "#4dd0c4", order: 9 },
];

const RUNTIME_COUPLING = couplingMapFromCategories(RUNTIME_CATEGORIES);

/** 最小可用的 MapPoiData（耦合只消费 categories 字段）。 */
function poiDataWithCategories(categories: readonly PoiCategory[]): MapPoiData {
  return { categories } as unknown as MapPoiData;
}

function resetCouplingStores(): void {
  usePoiFilterStore.setState({ hiddenCategories: [] });
  useMapDataStore.setState({ mapId: null, bundle: null, poiData: null });
  useViewCoupling.setState({
    groupVisible: allGroupsVisible(),
    lastSource: null,
    sandboxLocate: null,
  });
}

beforeEach(resetCouplingStores);

describe("分类 → 组 耦合解析（运行时 t<TypeId> 分类）", () => {
  it("数据包派生分类按显示名归类：物资/红/出生/撤离", () => {
    expect(sandboxGroupForCategory({ id: "t7", label: "撤离点" })).toBe("extraction");
    expect(sandboxGroupForCategory({ id: "t6", label: "出生点" })).toBe("spawn");
    expect(sandboxGroupForCategory({ id: "t1", label: "物资点" })).toBe("loot");
    expect(sandboxGroupForCategory({ id: "t2", label: "刷红点" })).toBe("red-loot");
  });

  it("未命中关键词的分类不参与耦合（首领/钥匙房/地图信息/任务）", () => {
    expect(sandboxGroupForCategory({ id: "t3", label: "首领boss" })).toBeNull();
    expect(sandboxGroupForCategory({ id: "t5", label: "钥匙房" })).toBeNull();
    expect(sandboxGroupForCategory({ id: "t8", label: "地图信息" })).toBeNull();
    expect(sandboxGroupForCategory({ id: "t9", label: "任务" })).toBeNull();
  });

  it("内置兜底 id 直映：extract→extraction、supply→loot、spawn→spawn；objective/landmark/hazard 不耦合", () => {
    expect(sandboxGroupForCategory({ id: "extract" })).toBe("extraction");
    expect(sandboxGroupForCategory({ id: "supply" })).toBe("loot");
    expect(sandboxGroupForCategory({ id: "spawn" })).toBe("spawn");
    expect(sandboxGroupForCategory({ id: "objective" })).toBeNull();
    expect(sandboxGroupForCategory({ id: "landmark" })).toBeNull();
    expect(sandboxGroupForCategory({ id: "hazard" })).toBeNull();
  });

  it("couplingMapFromCategories：仅映射命中分类", () => {
    expect(RUNTIME_COUPLING.size).toBe(4);
    expect(RUNTIME_COUPLING.get("t1")).toBe("loot");
    expect(RUNTIME_COUPLING.get("t2")).toBe("red-loot");
    expect(RUNTIME_COUPLING.get("t6")).toBe("spawn");
    expect(RUNTIME_COUPLING.get("t7")).toBe("extraction");
  });

  it("currentSandboxCoupling：数据未加载回退内置表；poiData 就绪后取运行时分类", () => {
    const fallback = currentSandboxCoupling();
    expect(fallback.get("extract")).toBe("extraction");
    expect(fallback.get("t7")).toBeUndefined();

    useMapDataStore
      .getState()
      .setMapData(101, null as never, poiDataWithCategories(RUNTIME_CATEGORIES));
    expect(currentSandboxCoupling().get("t7")).toBe("extraction");
  });
});

describe("组可见性 ↔ 3D 隐藏分类 换算（运行时分类）", () => {
  it("隐藏 t1（物资点）→ 仅 loot 组不可见；event 组无映射分类保持可见", () => {
    const visible = groupsFromHiddenCategories(["t1"], RUNTIME_COUPLING);
    expect(visible.loot).toBe(false);
    expect(visible["red-loot"]).toBe(true);
    expect(visible.extraction).toBe(true);
    expect(visible.spawn).toBe(true);
    expect(visible.event).toBe(true);
  });

  it("组可见 ⇔ 其映射分类任一未隐藏", () => {
    const visible = groupsFromHiddenCategories(["t7", "t6"], RUNTIME_COUPLING);
    expect(visible.extraction).toBe(false);
    expect(visible.spawn).toBe(false);
    expect(visible.loot).toBe(true);
  });

  it("耦合分类隐藏 ⇔ 其映射组不可见；未耦合分类保持原样", () => {
    const hidden = hiddenCategoriesFromGroups(
      { event: false, extraction: false, loot: false, "red-loot": false, spawn: true },
      ["t3", "t5"],
      RUNTIME_COUPLING,
    );
    // 仅 spawn 组可见 ⇒ t6 显示、t1/t2/t7 隐藏；t3/t5（未耦合）原样保留。
    expect(hidden).toContain("t1");
    expect(hidden).toContain("t2");
    expect(hidden).toContain("t7");
    expect(hidden).not.toContain("t6");
    expect(hidden).toContain("t3");
    expect(hidden).toContain("t5");
  });

  it("全组可见 → 不新增隐藏；categoriesForGroup 返回组内分类全集", () => {
    const hidden = hiddenCategoriesFromGroups(allGroupsVisible(), ["t3"], RUNTIME_COUPLING);
    expect(hidden).toEqual(["t3"]);
    expect(categoriesForGroup(RUNTIME_COUPLING, "loot")).toEqual(["t1"]);
    expect(categoriesForGroup(RUNTIME_COUPLING, "event")).toEqual([]);
  });
});

describe("耦合状态机：双向同步与防回环（运行时分类）", () => {
  it("3D 侧隐藏 t1 → syncFromPoiFilter 广播组态（lastSource=poiFilter）", () => {
    useMapDataStore
      .getState()
      .setMapData(101, null as never, poiDataWithCategories(RUNTIME_CATEGORIES));
    usePoiFilterStore.getState().toggleCategory("t1");
    useViewCoupling.getState().syncFromPoiFilter(usePoiFilterStore.getState().hiddenCategories);

    const state = useViewCoupling.getState();
    expect(state.lastSource).toBe("poiFilter");
    expect(state.groupVisible.loot).toBe(false);
    expect(state.groupVisible["red-loot"]).toBe(true);
    expect(state.groupVisible.extraction).toBe(true);
  });

  it("2D 侧变化 → syncFromSandbox 广播组态（lastSource=sandbox）", () => {
    useViewCoupling.getState().syncFromSandbox({
      event: true,
      extraction: false,
      loot: false,
      "red-loot": false,
      spawn: true,
    });
    const state = useViewCoupling.getState();
    expect(state.lastSource).toBe("sandbox");
    expect(state.groupVisible.extraction).toBe(false);
    expect(state.groupVisible.spawn).toBe(true);
  });

  it("applySandboxGroupsToPoiFilter（运行时分类）：2D 仅勾 spawn → t1/t2/t7 隐藏、t6 显示、未耦合不动", () => {
    useMapDataStore
      .getState()
      .setMapData(101, null as never, poiDataWithCategories(RUNTIME_CATEGORIES));
    // 预置未参与耦合的隐藏项，2D 组级变化不得波及。
    usePoiFilterStore.setState({ hiddenCategories: ["t3"] });
    applySandboxGroupsToPoiFilter(
      // 仅出生点组保留可见
      { event: false, extraction: false, loot: false, "red-loot": false, spawn: true },
    );
    expect([...usePoiFilterStore.getState().hiddenCategories].toSorted()).toEqual(
      ["t1", "t2", "t3", "t7"].toSorted(),
    );

    // 幂等：同一组态再次应用不产生新写入（hiddenCategories 引用不变）。
    const before = usePoiFilterStore.getState().hiddenCategories;
    applySandboxGroupsToPoiFilter({
      event: false,
      extraction: false,
      loot: false,
      "red-loot": false,
      spawn: true,
    });
    expect(usePoiFilterStore.getState().hiddenCategories).toBe(before);
  });

  it("applySandboxGroupsToPoiFilter（数据未加载兜底）：内置 id 同义耦合仍生效", () => {
    applySandboxGroupsToPoiFilter(allGroupsVisible());
    expect(usePoiFilterStore.getState().hiddenCategories).toEqual([]);
  });

  it("完整双向链路无回环：3D 隐藏 t7 → 广播 → 2D 回广播 → 3D 收敛", () => {
    useMapDataStore
      .getState()
      .setMapData(101, null as never, poiDataWithCategories(RUNTIME_CATEGORIES));

    // 1) 用户在 3D 侧栏隐藏撤离点 → 广播
    usePoiFilterStore.getState().toggleCategory("t7");
    useViewCoupling.getState().syncFromPoiFilter(usePoiFilterStore.getState().hiddenCategories);
    expect(usePoiFilterStore.getState().hiddenCategories).toEqual(["t7"]);
    expect(useViewCoupling.getState().groupVisible.extraction).toBe(false);

    // 2) 2D 侧应用后再回广播同一组态
    useViewCoupling.getState().syncFromSandbox(useViewCoupling.getState().groupVisible);
    expect(useViewCoupling.getState().lastSource).toBe("sandbox");

    // 3) 桥接消费（ViewCouplingBridge 行为）：按组态回写 → 与现状一致，无变化
    applySandboxGroupsToPoiFilter(useViewCoupling.getState().groupVisible);
    expect(usePoiFilterStore.getState().hiddenCategories).toEqual(["t7"]);
  });
});

describe("跨视图定位请求（3D→2D）", () => {
  it("requestSandboxLocate 携带世界坐标并自增 token；consume 幂等", () => {
    useViewCoupling.getState().requestSandboxLocate({ x: 1, y: 2, z: 3 });
    const first = useViewCoupling.getState().sandboxLocate;
    expect(first?.world).toEqual({ x: 1, y: 2, z: 3 });

    useViewCoupling.getState().requestSandboxLocate({ x: 4, y: 5, z: 6 });
    const second = useViewCoupling.getState().sandboxLocate;
    // token 单调递增（consume 不复位计数）。
    expect(second?.token).toBe((first?.token ?? 0) + 1);
    expect(second?.world).toEqual({ x: 4, y: 5, z: 6 });

    useViewCoupling.getState().consumeSandboxLocate();
    expect(useViewCoupling.getState().sandboxLocate).toBeNull();
    // 对空目标重复消费是幂等的。
    useViewCoupling.getState().consumeSandboxLocate();
    expect(useViewCoupling.getState().sandboxLocate).toBeNull();
  });

  it("同一目标重复请求也能触发（consume 后 token 仍递增）", () => {
    useViewCoupling.getState().requestSandboxLocate({ x: 9, y: 9, z: 9 });
    const first = useViewCoupling.getState().sandboxLocate;
    useViewCoupling.getState().consumeSandboxLocate();
    useViewCoupling.getState().requestSandboxLocate({ x: 9, y: 9, z: 9 });
    const second = useViewCoupling.getState().sandboxLocate;
    expect(second?.token).toBe((first?.token ?? 0) + 1);
    expect(second?.world).toEqual({ x: 9, y: 9, z: 9 });
  });
});

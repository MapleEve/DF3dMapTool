import { create } from "zustand";
import type { Vec3 } from "@/common/geometry";
import { POI_CATEGORIES, type PoiCategory, type PoiCategoryId } from "@/poi";
import { useMapDataStore } from "./mapDataStore";
import { usePoiFilterStore } from "./poiFilterStore";

/** 2D 沙盘的分类组标识（站点图例分组）。 */
export type SandboxGroupId = "event" | "extraction" | "loot" | "red-loot" | "spawn";

export const SANDBOX_GROUP_IDS: readonly SandboxGroupId[] = [
  "event",
  "extraction",
  "loot",
  "red-loot",
  "spawn",
];

/**
 * 分类 → 2D 组 的耦合解析（应用层自定义语义，代码常量，不入数据包）。
 *
 * 运行时 3D 分类为数据包派生的 `t<TypeId>`（显示名来自类型配置，如"物资点/刷红点/
 * 出生点/撤离点"），内置静态 id（extract/supply/spawn）仅在数据未加载的兜底态出现。
 * 因此映射按**分类 id + 显示名关键词**解析，而非写死 id 常量：
 * - extraction ↔ 撤离点（"撤离"/extraction）；spawn ↔ 出生点（"出生"/spawn）
 * - loot ↔ 物资点（"物资"/loot）；red-loot ↔ 刷红点（"红"/red）
 * - 未命中关键词的分类（首领/特殊兵种/钥匙房/地图信息/任务/objective/landmark/hazard）
 *   与无 3D 对应的组（event）不参与耦合——"部分耦合"的边界。
 */
const LABEL_KEYWORD_RULES: readonly {
  readonly keywords: readonly string[];
  readonly group: SandboxGroupId;
}[] = [
  { keywords: ["撤离", "extraction"], group: "extraction" },
  { keywords: ["出生", "spawn"], group: "spawn" },
  // red-loot 先于 loot 判定（"刷红点"命中红、"物资点"不命中红，顺序仅为确定性）。
  { keywords: ["红", "red"], group: "red-loot" },
  { keywords: ["物资", "loot", "supply"], group: "loot" },
];

/** 单个分类的耦合解析：返回参与的 2D 组；null = 不参与耦合。 */
export function sandboxGroupForCategory(category: {
  readonly id: PoiCategoryId;
  readonly label?: string;
}): SandboxGroupId | null {
  switch (category.id) {
    // 内置兜底 id 直映（数据包未加载时保持同义耦合）。
    case "extract":
      return "extraction";
    case "supply":
      return "loot";
    case "spawn":
      return "spawn";
    default:
      break;
  }
  const label = category.label ?? "";
  if (label === "") {
    return null;
  }
  for (const rule of LABEL_KEYWORD_RULES) {
    if (rule.keywords.some((keyword) => label.toLowerCase().includes(keyword))) {
      return rule.group;
    }
  }
  return null;
}

/** 参与耦合的分类集（categoryId → 2D 组）。 */
export type SandboxCouplingMap = ReadonlyMap<PoiCategoryId, SandboxGroupId>;

/** 分类表 → 耦合映射（未命中关键词的分类不进入映射）。 */
export function couplingMapFromCategories(categories: readonly PoiCategory[]): SandboxCouplingMap {
  const map = new Map<PoiCategoryId, SandboxGroupId>();
  for (const category of categories) {
    const group = sandboxGroupForCategory(category);
    if (group !== null) {
      map.set(category.id, group);
    }
  }
  return map;
}

/**
 * 当前耦合映射：数据包派生分类优先（mapDataStore.poiData.categories），
 * 未加载时回退内置分类表。调用方在用户动作发生时解析，读到的是当下分类态。
 */
export function currentSandboxCoupling(): SandboxCouplingMap {
  const poiData = useMapDataStore.getState().poiData;
  const categories =
    poiData !== null && poiData.categories.length > 0 ? poiData.categories : POI_CATEGORIES;
  return couplingMapFromCategories(categories);
}

/** 全组可见的初始态（与 3D 默认全显对齐）。 */
export function allGroupsVisible(): Record<SandboxGroupId, boolean> {
  return { event: true, extraction: true, loot: true, "red-loot": true, spawn: true };
}

/** 组 → 参与耦合的分类 id 集（无耦合分类的组为空集）。 */
export function categoriesForGroup(
  coupling: SandboxCouplingMap,
  group: SandboxGroupId,
): PoiCategoryId[] {
  const ids: PoiCategoryId[] = [];
  for (const [categoryId, mapped] of coupling) {
    if (mapped === group) {
      ids.push(categoryId);
    }
  }
  return ids;
}

/**
 * 由 3D 隐藏分类推导各组可见性：组可见 ⇔ 其映射分类任一未隐藏；
 * 无映射分类的组（如 event）不由 3D 侧决定，保持可见。
 */
export function groupsFromHiddenCategories(
  hidden: readonly PoiCategoryId[],
  coupling: SandboxCouplingMap,
): Record<SandboxGroupId, boolean> {
  const visible = allGroupsVisible();
  for (const group of SANDBOX_GROUP_IDS) {
    const ids = categoriesForGroup(coupling, group);
    if (ids.length === 0) {
      continue;
    }
    visible[group] = ids.some((id) => !hidden.includes(id));
  }
  return visible;
}

/**
 * 由各组可见性推导 3D 隐藏表：耦合分类隐藏 ⇔ 其映射组不可见。
 * 未参与耦合的分类（首领/钥匙房/地图信息/任务/objective/landmark/hazard 等）
 * 保持 currentHidden 原样。
 */
export function hiddenCategoriesFromGroups(
  groupVisible: Readonly<Record<SandboxGroupId, boolean>>,
  currentHidden: readonly PoiCategoryId[],
  coupling: SandboxCouplingMap,
): PoiCategoryId[] {
  const next = new Set<PoiCategoryId>(currentHidden);
  for (const [categoryId, group] of coupling) {
    if (groupVisible[group]) {
      next.delete(categoryId);
    } else {
      next.add(categoryId);
    }
  }
  return [...next];
}

/**
 * 2D 组级勾选变化 → 3D 分类显隐（桥接组件消费）。
 * 只调整参与耦合的分类，其余分类不动；无实际变化时不写 store（防抖动/防回环）。
 */
export function applySandboxGroupsToPoiFilter(
  groupVisible: Readonly<Record<SandboxGroupId, boolean>>,
): void {
  const { hiddenCategories } = usePoiFilterStore.getState();
  const next = hiddenCategoriesFromGroups(groupVisible, hiddenCategories, currentSandboxCoupling());
  const changed =
    next.length !== hiddenCategories.length ||
    next.some((category, index) => category !== hiddenCategories[index]);
  if (changed) {
    usePoiFilterStore.setState({ hiddenCategories: next });
  }
}

/** 同步来源标记：应用侧只消费对方发起的变更，防止双向回环。 */
export type CouplingSource = "poiFilter" | "sandbox";

/** 3D→2D 定位请求：携带 3D 世界坐标，2D 视图经站点仿射换算后居中（区域级近似定位）。 */
export interface SandboxLocateRequest {
  readonly world: Vec3;
  /** 自增 token：同一目标的重复请求也能触发。 */
  readonly token: number;
}

/** 定位请求 token：模块级单调递增，consume 清空请求对象但不复位计数。 */
let locateToken = 0;

interface ViewCouplingState {
  /** 各组可见性（true = 该组在 2D 侧有勾选）。 */
  groupVisible: Readonly<Record<SandboxGroupId, boolean>>;
  /** 最近一次组级同步的来源。 */
  lastSource: CouplingSource | null;
  /**
   * 3D 侧分类筛选变化后调用（3D 侧栏勾选处理器）；
   * 广播给 2D 侧（沙盘侧栏订阅后按组勾选/取消）。
   */
  syncFromPoiFilter: (hidden: readonly PoiCategoryId[]) => void;
  /**
   * 2D 侧组级勾选变化后调用（沙盘侧栏；换图自动复位不调用——非用户意图不同步）。
   */
  syncFromSandbox: (groupVisible: Readonly<Record<SandboxGroupId, boolean>>) => void;
  /** 3D→2D 定位请求（世界坐标）；2D 视图订阅消费。 */
  sandboxLocate: SandboxLocateRequest | null;
  /** 发起 3D→2D 定位（POI 气泡等入口调用；消费方负责经仿射换算居中）。 */
  requestSandboxLocate: (world: Vec3) => void;
  consumeSandboxLocate: () => void;
}

/**
 * 2D/3D 双视图耦合状态：分类筛选的组级双向同步 + 跨视图定位请求。
 * 选图/楼层/搜索文本不在此处——分别由 mapStore/floorStore/searchStore 单源共享。
 */
export const useViewCoupling = create<ViewCouplingState>()((set) => ({
  groupVisible: allGroupsVisible(),
  lastSource: null,
  syncFromPoiFilter: (hidden) => {
    set({
      groupVisible: groupsFromHiddenCategories(hidden, currentSandboxCoupling()),
      lastSource: "poiFilter",
    });
  },
  syncFromSandbox: (groupVisible) => {
    set({ groupVisible, lastSource: "sandbox" });
  },
  sandboxLocate: null,
  requestSandboxLocate: (world) => {
    locateToken += 1;
    set({ sandboxLocate: { world, token: locateToken } });
  },
  consumeSandboxLocate: () => {
    set((state) => (state.sandboxLocate !== null ? { sandboxLocate: null } : state));
  },
}));

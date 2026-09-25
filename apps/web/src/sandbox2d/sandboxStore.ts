/**
 * 2D 沙盘专属交互状态（sandbox2d 模块内）。
 *
 * 与共享状态的关系（设计 §2.2 耦合契约）：
 * - 选图/楼层在 mapStore/floorStore（单源）；本 store 只持 2D 专属派生态
 *   （floorAll"全图"开关为 2D 专属——上游楼层下拉含 All，3D 域无此概念）；
 * - 搜索文本在 searchStore（单源共享）；具名点位"选中某个结果"（searchTarget）为 2D 专属；
 * - POI 选中不跨视图携带（selectedPointId 独立于 poiStore.selectedPoiId）。
 *
 * 持久化：filters 子集随 localStorage（上游过滤持久化同语义），换图时全量复位
 * （上游换图即全量复位）。复位与持久化由 Sandbox2dView 的 mapId 效应驱动，store 自身保持纯同步。
 */

import { create } from "zustand";
import type { SandboxGroupId } from "./types";

/** 具名点位搜索选中（location 过滤的 {item,x,y} 三元组）。 */
export interface SandboxSearchTarget {
  readonly item: string;
  readonly x: number;
  readonly y: number;
}

interface SandboxStoreState {
  // ---- 过滤（上游过滤语义）----
  /** 难度："all" | "easy" | "normal"。 */
  difficulty: string;
  /** 楼层："all" 或站点楼层数字字符串。 */
  floor: string;
  /** 具名点位选中；null = All。 */
  searchTarget: SandboxSearchTarget | null;
  /** 勾选的分类 id 集（空集 = 无标记上图，上游默认）。 */
  selectedItems: readonly string[];
  /** 组页签："all" 或组 slug。 */
  activeGroup: "all" | SandboxGroupId;
  /** 类型搜索已提交文本（侧栏类型清单过滤）。 */
  submittedSearch: string;

  // ---- 交互选中/面板 ----
  /** 过滤态所属图（图章，随持久化）：与当前图不符 → 视图触发换图复位。 */
  filtersMapId: number | null;
  /** 地图上选中的点位（详情面板数据源）；null = 侧栏态。 */
  selectedPointId: number | null;
  /** 选中的区域（高亮）；null = 未选。 */
  selectedRegionId: string | null;
  /** 右键坐标弹窗（全分辨率坐标 + 视口内屏幕位置）。 */
  coordinatePopup: { sx: number; sy: number; screenX: number; screenY: number } | null;

  setDifficulty: (difficulty: string) => void;
  setFloor: (floor: string) => void;
  setSearchTarget: (target: SandboxSearchTarget | null) => void;
  toggleItem: (itemId: string) => void;
  setItems: (items: readonly string[]) => void;
  /** Select All 开关：true 并入可见集，false 移出可见集（并集/差集语义）。 */
  selectVisible: (visible: readonly string[], select: boolean) => void;
  setActiveGroup: (group: "all" | SandboxGroupId) => void;
  setSubmittedSearch: (query: string) => void;
  selectPoint: (pointId: number | null) => void;
  selectRegion: (regionId: string | null) => void;
  setCoordinatePopup: (popup: SandboxStoreState["coordinatePopup"]) => void;
  /** 换图/复位：过滤与选中全量清空（上游换图复位 + 全不勾）。 */
  resetAll: () => void;
  /**
   * 换图复位（带图章）：清过滤并把 filtersMapId 盖章为当前图（随持久化保存）。
   * 视图据此判定「是否真的换了图」——同一图重挂载（3D↔2D 切换/重载恢复）不触发复位，
   * 持久化过滤态得以存活；换图才全量复位（设计 §1.3 #2 的「仅换图复位」语义）。
   */
  resetForMap: (mapId: number) => void;
}

/** 过滤子集的持久化键。 */
const FILTERS_STORAGE_KEY = "df3dmaptool:sandbox2d-filters";

interface PersistedFilters {
  /** 过滤态所属图（图章）：与当前图不符时视图触发换图复位。 */
  mapId: number | null;
  difficulty: string;
  floor: string;
  searchTarget: SandboxSearchTarget | null;
  selectedItems: readonly string[];
  activeGroup: "all" | SandboxGroupId;
}

function readPersistedFilters(): Partial<PersistedFilters> {
  try {
    const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
    if (raw === null) {
      return {};
    }
    const parsed = JSON.parse(raw) as Partial<PersistedFilters>;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function persistFilters(state: SandboxStoreState): void {
  try {
    const payload: PersistedFilters = {
      mapId: state.filtersMapId,
      difficulty: state.difficulty,
      floor: state.floor,
      searchTarget: state.searchTarget,
      selectedItems: state.selectedItems,
      activeGroup: state.activeGroup,
    };
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // 持久化失败不阻塞
  }
}

function clearPersistedFilters(): void {
  try {
    localStorage.removeItem(FILTERS_STORAGE_KEY);
  } catch {
    // 忽略
  }
}

const persisted = readPersistedFilters();

/**
 * 勾选变化监听（用户意图动作——toggle/selectVisible/setItems 触发；resetAll 不触发）。
 * Sandbox2dView 注册后把组级可见性同步到 viewCoupling（2D→3D 方向）。
 */
type SelectionListener = (selectedItems: readonly string[]) => void;
let selectionListener: SelectionListener | null = null;

function notifySelectionListener(selectedItems: readonly string[]): void {
  selectionListener?.(selectedItems);
}

/** 注册/注销勾选监听（视图挂载周期内持有）。 */
export function setSandboxSelectionListener(listener: SelectionListener | null): void {
  selectionListener = listener;
}

export const useSandboxStore = create<SandboxStoreState>()((set, get) => {
  /** 过滤变化后同步持久化。 */
  const withPersist = (partial: Partial<SandboxStoreState>) => {
    set(partial);
    persistFilters(get());
  };
  return {
    filtersMapId: typeof persisted.mapId === "number" ? persisted.mapId : null,
    difficulty: typeof persisted.difficulty === "string" ? persisted.difficulty : "all",
    floor: typeof persisted.floor === "string" ? persisted.floor : "all",
    searchTarget:
      persisted.searchTarget !== null &&
      typeof persisted.searchTarget === "object" &&
      typeof persisted.searchTarget.item === "string" &&
      typeof persisted.searchTarget.x === "number" &&
      typeof persisted.searchTarget.y === "number"
        ? persisted.searchTarget
        : null,
    selectedItems: Array.isArray(persisted.selectedItems) ? persisted.selectedItems : [],
    activeGroup: persisted.activeGroup ?? "all",
    submittedSearch: "",
    selectedPointId: null,
    selectedRegionId: null,
    coordinatePopup: null,

    setDifficulty: (difficulty) => withPersist({ difficulty }),
    setFloor: (floor) => withPersist({ floor }),
    setSearchTarget: (searchTarget) => withPersist({ searchTarget }),
    toggleItem: (itemId) => {
      const current = get().selectedItems;
      const next = current.includes(itemId)
        ? current.filter((id) => id !== itemId)
        : [...current, itemId];
      withPersist({ selectedItems: next });
      notifySelectionListener(next);
    },
    setItems: (selectedItems) => {
      withPersist({ selectedItems });
      notifySelectionListener(selectedItems);
    },
    selectVisible: (visible, select) => {
      const current = get().selectedItems;
      const visibleSet = new Set(visible);
      const next = select
        ? [...new Set([...current, ...visible])]
        : current.filter((id) => !visibleSet.has(id));
      withPersist({ selectedItems: next });
      notifySelectionListener(next);
    },
    setActiveGroup: (activeGroup) => withPersist({ activeGroup }),
    setSubmittedSearch: (submittedSearch) => set({ submittedSearch }),
    selectPoint: (selectedPointId) => set({ selectedPointId }),
    selectRegion: (selectedRegionId) => set({ selectedRegionId }),
    setCoordinatePopup: (coordinatePopup) => set({ coordinatePopup }),
    resetAll: () => {
      clearPersistedFilters();
      set({
        filtersMapId: null,
        difficulty: "all",
        floor: "all",
        searchTarget: null,
        selectedItems: [],
        activeGroup: "all",
        submittedSearch: "",
        selectedPointId: null,
        selectedRegionId: null,
        coordinatePopup: null,
      });
    },
    resetForMap: (mapId) => {
      // 换图复位：值回默认 + 图章改章并随持久化保存（同图重挂载不复发位）。
      set({
        filtersMapId: mapId,
        difficulty: "all",
        floor: "all",
        searchTarget: null,
        selectedItems: [],
        activeGroup: "all",
        submittedSearch: "",
        selectedPointId: null,
        selectedRegionId: null,
        coordinatePopup: null,
      });
      persistFilters(get());
    },
  };
});

/** 测试隔离：清空 store 与持久化。 */
export function resetSandboxStoreForTest(): void {
  clearPersistedFilters();
  useSandboxStore.setState({
    filtersMapId: null,
    difficulty: "all",
    floor: "all",
    searchTarget: null,
    selectedItems: [],
    activeGroup: "all",
    submittedSearch: "",
    selectedPointId: null,
    selectedRegionId: null,
    coordinatePopup: null,
  });
}

/**
 * 2D 沙盘过滤逻辑（上游过滤语义逐字还原；单测锚定，勿"好心修正"）。
 *
 * 上游行为（实测）：
 * - 难度：mode==="all" 通过；difficulties 缺失/非数组时通过；否则须包含 mode。
 * - 具名点位：location 为空通过；否则 item_id/x/y 三元组精确匹配。
 * - 分类勾选：selectAll（iPad/console 态）通过；否则 selectedItems 非空且包含 item_id
 *   —— 空集 = 无标记上图（默认全不勾）。
 * - 楼层：floor 为空或 "all" 通过；否则 z === parseInt(floor)——
 *   **z=null 的点位在具体楼层下被隐藏**（实测锚定，如实复刻不修正）。
 */

import type { SandboxPoint } from "./types";

/** 过滤态（对应上游过滤持久化的 filters）。 */
export interface SandboxFilters {
  /** 难度："all" | "easy" | "normal" | ...（上游 mode 字段）。 */
  readonly difficulty: string;
  /** 楼层："all" 或站点楼层数字字符串。 */
  readonly floor: string;
  /** 具名点位选中（{item,x,y} 三元组；null = 未选）。 */
  readonly location: { readonly item: string; readonly x: number; readonly y: number } | null;
  /** 勾选的分类 id 集。 */
  readonly selectedItems: readonly string[];
}

export const DEFAULT_SANDBOX_FILTERS: SandboxFilters = {
  difficulty: "all",
  floor: "all",
  location: null,
  selectedItems: [],
};

/**
 * 过滤点位集。selectAll=true 表示忽略 selectedItems（侧栏计数场景：勾选与否不影响
 * 各分类在图上的潜在计数——上游侧栏计数即此口径）。
 */
export function filterSandboxPoints(
  points: readonly SandboxPoint[],
  filters: SandboxFilters,
  selectAll = false,
): SandboxPoint[] {
  if (points === null || points === undefined) {
    return [];
  }
  if (filters === null || filters === undefined) {
    return [...points];
  }
  const floorValue =
    filters.floor !== "" && filters.floor !== "all" ? Number.parseInt(filters.floor, 10) : null;
  return points.filter((point) => {
    // 难度：difficulties 缺失视为通过（短路语义）
    const difficultyOk =
      filters.difficulty === "all" ||
      !Array.isArray(point.difficulties) ||
      point.difficulties.includes(filters.difficulty);
    if (!difficultyOk) {
      return false;
    }
    // 具名点位：三元组精确匹配（item/x/y）
    if (
      filters.location !== null &&
      !(
        point.item === filters.location.item &&
        point.x === filters.location.x &&
        point.y === filters.location.y
      )
    ) {
      return false;
    }
    // 分类勾选：空集无标记（实测锚定）
    if (
      !selectAll &&
      !(
        Array.isArray(filters.selectedItems) &&
        filters.selectedItems.length !== 0 &&
        filters.selectedItems.includes(point.item)
      )
    ) {
      return false;
    }
    // 楼层：z=null 在具体楼层隐藏（z===parseInt(floor) 实测口径，勿修正）
    if (floorValue !== null && point.floor !== floorValue) {
      return false;
    }
    return true;
  });
}

/** 各分类在当前过滤（不含勾选）下的上图计数（侧栏角标）。 */
export function countPointsByItem(
  points: readonly SandboxPoint[],
  filters: SandboxFilters,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const point of filterSandboxPoints(points, filters, true)) {
    counts.set(point.item, (counts.get(point.item) ?? 0) + 1);
  }
  return counts;
}

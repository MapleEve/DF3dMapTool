/**
 * 2D 沙盘交互状态机测试（设计 §4.3：交互状态机）。
 *
 * 覆盖：过滤态切换、勾选集合运算（整组替换/并集/差集语义）、Select All 并集/差集、
 * 换图复位（resetAll 清持久化）、勾选监听器（耦合通道：用户意图触发/复位不触发）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubGlobal } from "@/testing/globals";

// node 测试环境无 localStorage：先装桩再装载 store（模块顶层的持久化恢复依赖它）
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

const { resetSandboxStoreForTest, setSandboxSelectionListener, useSandboxStore } =
  await import("./sandboxStore");

const FILTERS_KEY = "df3dmaptool:sandbox2d-filters";

beforeEach(() => {
  storage.clear();
  resetSandboxStoreForTest();
});

afterEach(() => {
  setSandboxSelectionListener(null);
});

describe("过滤态", () => {
  it("默认：difficulty/floor=all、无搜索目标、空勾选", () => {
    const state = useSandboxStore.getState();
    expect(state.difficulty).toBe("all");
    expect(state.floor).toBe("all");
    expect(state.searchTarget).toBeNull();
    expect(state.selectedItems).toEqual([]);
    expect(state.activeGroup).toBe("all");
    expect(state.selectedPointId).toBeNull();
    expect(state.selectedRegionId).toBeNull();
    expect(state.coordinatePopup).toBeNull();
  });

  it("难度/楼层/搜索目标可切换", () => {
    const state = useSandboxStore.getState();
    state.setDifficulty("easy");
    state.setFloor("-1");
    state.setSearchTarget({ item: "key_card", x: 1054, y: 1892 });
    const next = useSandboxStore.getState();
    expect(next.difficulty).toBe("easy");
    expect(next.floor).toBe("-1");
    expect(next.searchTarget).toEqual({ item: "key_card", x: 1054, y: 1892 });
  });
});

describe("勾选集合（上游语义）", () => {
  it("toggleItem 增删", () => {
    const state = useSandboxStore.getState();
    state.toggleItem("bird-nest");
    expect(useSandboxStore.getState().selectedItems).toEqual(["bird-nest"]);
    useSandboxStore.getState().toggleItem("bird-nest");
    expect(useSandboxStore.getState().selectedItems).toEqual([]);
  });

  it("selectVisible(true) 并入可见集（并集去重）", () => {
    useSandboxStore.getState().toggleItem("key_card");
    useSandboxStore.getState().selectVisible(["bird-nest", "key_card", "safe"], true);
    expect([...useSandboxStore.getState().selectedItems].toSorted()).toEqual([
      "bird-nest",
      "key_card",
      "safe",
    ]);
  });

  it("selectVisible(false) 移出可见集（保留不可见勾选）", () => {
    useSandboxStore.getState().setItems(["bird-nest", "key_card", "safe"]);
    useSandboxStore.getState().selectVisible(["bird-nest"], false);
    expect([...useSandboxStore.getState().selectedItems].toSorted()).toEqual(["key_card", "safe"]);
  });
});

describe("选中/面板态", () => {
  it("点位选中与详情互斥清除", () => {
    useSandboxStore.getState().selectPoint(1218);
    expect(useSandboxStore.getState().selectedPointId).toBe(1218);
    useSandboxStore.getState().selectPoint(null);
    expect(useSandboxStore.getState().selectedPointId).toBeNull();
  });

  it("坐标弹窗开关", () => {
    useSandboxStore.getState().setCoordinatePopup({ sx: 100, sy: 200, screenX: 10, screenY: 20 });
    expect(useSandboxStore.getState().coordinatePopup).toEqual({
      sx: 100,
      sy: 200,
      screenX: 10,
      screenY: 20,
    });
    useSandboxStore.getState().setCoordinatePopup(null);
    expect(useSandboxStore.getState().coordinatePopup).toBeNull();
  });
});

describe("换图复位与持久化", () => {
  it("resetAll：全部回默认并清持久化", () => {
    const state = useSandboxStore.getState();
    state.setDifficulty("normal");
    state.setFloor("1");
    state.setSearchTarget({ item: "x", x: 1, y: 2 });
    state.toggleItem("bird-nest");
    state.selectPoint(9);
    state.setCoordinatePopup({ sx: 0, sy: 0, screenX: 0, screenY: 0 });
    expect(storage.get(FILTERS_KEY)).not.toBeUndefined();

    useSandboxStore.getState().resetAll();
    const after = useSandboxStore.getState();
    expect(after.difficulty).toBe("all");
    expect(after.floor).toBe("all");
    expect(after.searchTarget).toBeNull();
    expect(after.selectedItems).toEqual([]);
    expect(after.selectedPointId).toBeNull();
    expect(after.coordinatePopup).toBeNull();
    expect(after.filtersMapId).toBeNull();
    expect(storage.get(FILTERS_KEY)).toBeUndefined();
  });

  it("过滤变化写入持久化（上游过滤持久化同语义）", () => {
    useSandboxStore.getState().setFloor("2");
    const stored = JSON.parse(storage.get(FILTERS_KEY) ?? "{}");
    expect(stored.floor).toBe("2");
  });

  it("resetForMap：清过滤并图章随持久化保存（同图重挂载不复位）", () => {
    useSandboxStore.getState().setDifficulty("normal");
    useSandboxStore.getState().toggleItem("bird-nest");
    useSandboxStore.getState().resetForMap(101);

    const after = useSandboxStore.getState();
    expect(after.filtersMapId).toBe(101);
    expect(after.difficulty).toBe("all");
    expect(after.selectedItems).toEqual([]);
    const stored = JSON.parse(storage.get(FILTERS_KEY) ?? "{}");
    expect(stored.mapId).toBe(101);

    // 同图重挂载判定：图章一致 → 保留过滤态（视图侧据此跳过复位）
    useSandboxStore.getState().setDifficulty("easy");
    expect(useSandboxStore.getState().filtersMapId).toBe(101);

    // 换图判定：图章 101 ≠ 102 → 视图侧将触发复位
    expect(useSandboxStore.getState().filtersMapId).not.toBe(102);
    useSandboxStore.getState().resetForMap(102);
    expect(useSandboxStore.getState().filtersMapId).toBe(102);
    expect(useSandboxStore.getState().difficulty).toBe("all");
  });
});

describe("勾选监听器（2D→3D 耦合通道）", () => {
  it("用户意图动作触发监听；resetAll 不触发", () => {
    const listener = vi.fn();
    setSandboxSelectionListener(listener);

    useSandboxStore.getState().toggleItem("bird-nest");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(["bird-nest"]);

    useSandboxStore.getState().setItems(["key_card"]);
    expect(listener).toHaveBeenCalledTimes(2);

    useSandboxStore.getState().resetAll();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

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

const { useViewStore, readStoredView } = await import("./viewStore");

function resetViewStore(): void {
  useViewStore.setState({ view: "3d", sandboxDismiss: null });
}

beforeEach(() => {
  storage.clear();
  resetViewStore();
});

describe("viewStore：index 级 2D/3D 切换状态机", () => {
  it("默认 3D 视图（模块装载时无存储值）", () => {
    expect(useViewStore.getState().view).toBe("3d");
  });

  it("setView 双向切换并持久化", () => {
    useViewStore.getState().setView("2d");
    expect(useViewStore.getState().view).toBe("2d");
    expect(storage.get("df3dmaptool:view")).toBe("2d");

    useViewStore.getState().setView("3d");
    expect(useViewStore.getState().view).toBe("3d");
    expect(storage.get("df3dmaptool:view")).toBe("3d");
  });

  it("toggleView 在两视图间翻转", () => {
    expect(useViewStore.getState().view).toBe("3d");
    useViewStore.getState().toggleView();
    expect(useViewStore.getState().view).toBe("2d");
    useViewStore.getState().toggleView();
    expect(useViewStore.getState().view).toBe("3d");
  });

  it("启动恢复：持久化 '2d' → 2D 视图；非法值回退 3D", () => {
    expect(readStoredView()).toBe("3d"); // 无存储值
    storage.set("df3dmaptool:view", "2d");
    expect(readStoredView()).toBe("2d");
    storage.set("df3dmaptool:view", "3d");
    expect(readStoredView()).toBe("3d");
    storage.set("df3dmaptool:view", "3d-view");
    expect(readStoredView()).toBe("3d");
  });
});

describe("viewStore：2D 视图 Esc 关闭器注册", () => {
  it("注册、调用与注销（App 外壳 Esc 逐层关闭的对接点）", () => {
    let dismissed = false;
    useViewStore.getState().registerSandboxDismiss(() => {
      dismissed = true;
      return true;
    });
    expect(useViewStore.getState().sandboxDismiss).toBeTypeOf("function");

    const consumed = useViewStore.getState().sandboxDismiss?.();
    expect(consumed).toBe(true);
    expect(dismissed).toBe(true);

    useViewStore.getState().registerSandboxDismiss(null);
    expect(useViewStore.getState().sandboxDismiss).toBeNull();
  });

  it("未注册时 sandboxDismiss 为 null（Esc 交由外壳兜底）", () => {
    expect(useViewStore.getState().sandboxDismiss).toBeNull();
  });
});

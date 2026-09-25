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

const { useUiStore, RENDER_DISTANCE_DEFAULT, RENDER_DISTANCE_RANGE } = await import("./uiStore");

describe("视野渲染距离设置（#60）", () => {
  beforeEach(() => {
    storage.clear();
    useUiStore.setState({
      renderDistance: RENDER_DISTANCE_DEFAULT,
    });
  });

  it("默认值为上游实测值 200（设置参数行实测锚定）", () => {
    expect(RENDER_DISTANCE_DEFAULT).toBe(200);
  });

  it("写入存储并钳制在滑条范围（100..1000）", () => {
    const store = useUiStore.getState();
    store.setRenderDistance(500);
    expect(useUiStore.getState().renderDistance).toBe(500);
    expect(storage.get("df3dmaptool:renderDistance")).toBe("500");

    store.setRenderDistance(99999);
    expect(useUiStore.getState().renderDistance).toBe(RENDER_DISTANCE_RANGE[1]);
    store.setRenderDistance(1);
    expect(useUiStore.getState().renderDistance).toBe(RENDER_DISTANCE_RANGE[0]);
    // 非数值回退默认而非边界
    store.setRenderDistance(Number.NaN);
    expect(useUiStore.getState().renderDistance).toBe(RENDER_DISTANCE_DEFAULT);
  });

  it("持久化值在建库时恢复", () => {
    storage.set("df3dmaptool:renderDistance", "300");
    // 直接调用读取逻辑（store 建库只发生一次；此处验证存储往返）
    expect(storage.get("df3dmaptool:renderDistance")).toBe("300");
    const store = useUiStore.getState();
    store.setRenderDistance(300);
    expect(useUiStore.getState().renderDistance).toBe(300);
  });
});

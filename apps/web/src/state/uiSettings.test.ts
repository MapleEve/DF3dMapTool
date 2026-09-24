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

const { useUiStore, FOV_DEFAULT, SENSITIVITY_DEFAULT } = await import("./uiStore");

describe("设置持久化（localStorage）", () => {
  beforeEach(() => {
    storage.clear();
    useUiStore.setState({
      settingsOpen: false,
      fov: FOV_DEFAULT,
      sensitivity: SENSITIVITY_DEFAULT,
      frameLimit: "unlimited",
      antialias: true,
      airJump: true,
      volume: 80,
      ambientMotes: true,
      cameraHud: null,
      screenshotHandler: null,
      respawnHandler: null,
    });
  });

  it("FOV 写入存储并钳制在合法范围", () => {
    useUiStore.getState().setFov(85);
    expect(useUiStore.getState().fov).toBe(85);
    expect(storage.get("df3dmaptool:fov")).toBe("85");

    useUiStore.getState().setFov(500);
    expect(useUiStore.getState().fov).toBe(100);
    useUiStore.getState().setFov(-5);
    expect(useUiStore.getState().fov).toBe(30);
    // 非数值输入回退默认值而非边界
    useUiStore.getState().setFov(Number.NaN);
    expect(useUiStore.getState().fov).toBe(FOV_DEFAULT);
  });

  it("灵敏度写入存储并钳制在合法范围", () => {
    useUiStore.getState().setSensitivity(1.6);
    expect(useUiStore.getState().sensitivity).toBeCloseTo(1.6);
    expect(storage.get("df3dmaptool:sensitivity")).toBe("1.6");

    useUiStore.getState().setSensitivity(99);
    expect(useUiStore.getState().sensitivity).toBe(3);
  });

  it("帧率上限与抗锯齿写入存储", () => {
    useUiStore.getState().setFrameLimit("30");
    expect(storage.get("df3dmaptool:frameLimit")).toBe("30");
    useUiStore.getState().setAntialias(false);
    expect(storage.get("df3dmaptool:antialias")).toBe("0");
    expect(useUiStore.getState().antialias).toBe(false);
  });

  it("源站对齐项（空中跳跃/音量/环境粒子）写存储且音量钳制 0..100", () => {
    useUiStore.getState().setAirJump(false);
    expect(storage.get("df3dmaptool:airJump")).toBe("0");
    useUiStore.getState().setAmbientMotes(false);
    expect(storage.get("df3dmaptool:ambientMotes")).toBe("0");
    useUiStore.getState().setVolume(255);
    expect(useUiStore.getState().volume).toBe(100);
    expect(storage.get("df3dmaptool:volume")).toBe("100");
  });

  it("回出生点：注册的执行器被调用，未注册时静默忽略", () => {
    let calls = 0;
    useUiStore.getState().registerRespawn(() => {
      calls += 1;
    });
    useUiStore.getState().requestRespawn();
    expect(calls).toBe(1);

    useUiStore.getState().registerRespawn(null);
    expect(() => useUiStore.getState().requestRespawn()).not.toThrow();
    expect(calls).toBe(1);
  });
});

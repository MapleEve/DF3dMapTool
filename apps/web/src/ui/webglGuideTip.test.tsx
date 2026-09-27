import { describe, expect, it } from "vitest";
import { stubGlobal } from "@/testing/globals";
import { resetWebglSupportCache, webglSupported } from "./WebglGuideTip";

describe("WebGL 支持探测（WebglGuideTip #65）", () => {
  it("webgl2/webgl/experimental-webgl 任一命中即视为可用", () => {
    resetWebglSupportCache();
    const contexts = new Map<string, unknown>([["webgl", {}]]);
    stubGlobal("document", {
      createElement: () => ({
        getContext: (type: string) => contexts.get(type) ?? null,
      }),
    });
    expect(webglSupported()).toBe(true);

    resetWebglSupportCache();
    contexts.clear();
    contexts.set("experimental-webgl", {});
    expect(webglSupported()).toBe(true);
  });

  it("全部上下文类型缺失 → 不可用；探测结果进程内缓存", () => {
    resetWebglSupportCache();
    stubGlobal("document", {
      createElement: () => ({ getContext: () => null }),
    });
    expect(webglSupported()).toBe(false);
    // 缓存生效：换桩后不再探测。
    stubGlobal("document", {
      createElement: () => ({ getContext: () => ({}) }),
    });
    expect(webglSupported()).toBe(false);
    resetWebglSupportCache();
    expect(webglSupported()).toBe(true);
  });

  it("getContext 抛异常按不可用处理", () => {
    resetWebglSupportCache();
    stubGlobal("document", {
      createElement: () => {
        throw new Error("no webgl");
      },
    });
    expect(webglSupported()).toBe(false);
  });

  it("无 document（SSR/测试）按可用处理", () => {
    resetWebglSupportCache();
    const had = "document" in globalThis;
    Reflect.deleteProperty(globalThis, "document");
    expect(webglSupported()).toBe(true);
    if (had) {
      // 还原交给测试框架的 stub 机制，这里仅验证语义。
      resetWebglSupportCache();
    }
  });
});

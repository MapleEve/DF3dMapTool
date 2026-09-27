import { describe, expect, it } from "vitest";
import { isBareHotkey } from "./hotkeys";

/** 构造最小键盘事件形态（浏览器 KeyboardEvent 的测试替身）。 */
function keyEvent(
  key: string,
  overrides: Partial<{
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    target: unknown;
  }> = {},
): Parameters<typeof isBareHotkey>[0] {
  return { key, ...overrides };
}

describe("全局热键判定（R 回出生点等）", () => {
  it("单键命中（大小写不敏感）", () => {
    expect(isBareHotkey(keyEvent("r"), "r")).toBe(true);
    expect(isBareHotkey(keyEvent("R"), "r")).toBe(true);
    expect(isBareHotkey(keyEvent("f"), "r")).toBe(false);
  });

  it("组合键不触发（Ctrl/Meta/Alt 留给浏览器与输入法）", () => {
    expect(isBareHotkey(keyEvent("r", { ctrlKey: true }), "r")).toBe(false);
    expect(isBareHotkey(keyEvent("r", { metaKey: true }), "r")).toBe(false);
    expect(isBareHotkey(keyEvent("r", { altKey: true }), "r")).toBe(false);
  });

  it("焦点在文本输入类控件上不触发", () => {
    expect(isBareHotkey(keyEvent("r", { target: { tagName: "INPUT" } }), "r")).toBe(false);
    expect(isBareHotkey(keyEvent("r", { target: { tagName: "TEXTAREA" } }), "r")).toBe(false);
    expect(isBareHotkey(keyEvent("r", { target: { tagName: "SELECT" } }), "r")).toBe(false);
    // 画布/普通节点与无目标照常触发。
    expect(isBareHotkey(keyEvent("r", { target: { tagName: "CANVAS" } }), "r")).toBe(true);
    expect(isBareHotkey(keyEvent("r", { target: null }), "r")).toBe(true);
    expect(isBareHotkey(keyEvent("r"), "r")).toBe(true);
  });
});

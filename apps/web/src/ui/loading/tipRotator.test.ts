import { describe, expect, it } from "vitest";
import { ManualScheduler, createTipRotator } from "./tipRotator";

const TIPS = ["一", "二", "三", "四"];

function setup(tips: readonly string[] = TIPS, intervalMs = 2000, animMs = 300) {
  const scheduler = new ManualScheduler();
  const texts: string[] = [];
  const hidden: boolean[] = [];
  const rotator = createTipRotator({
    tips,
    intervalMs,
    animMs,
    onText: (text) => {
      texts.push(text);
    },
    onHiddenChange: (value) => {
      hidden.push(value);
    },
    scheduler,
  });
  return { scheduler, rotator, texts, hidden };
}

describe("提示轮换状态机", () => {
  it("start 立即显示首条，并排程一个 interval", () => {
    const { scheduler, rotator, texts } = setup();
    rotator.start();
    expect(texts).toEqual(["一"]);
    expect(scheduler.intervalCount).toBe(1);
    expect(scheduler.timeoutCount).toBe(0);
  });

  it("interval 到点：先置 hidden，anim 后提交新文案并解除 hidden", () => {
    const { scheduler, rotator, texts, hidden } = setup();
    rotator.start();

    scheduler.fireInterval();
    expect(hidden).toEqual([true]);
    expect(texts).toEqual(["一"]); // anim 窗口内文案不变（硬切换）

    scheduler.fireTimeout();
    expect(texts).toEqual(["一", "二"]);
    expect(hidden).toEqual([true, false]);
  });

  it("连续轮换按序推进并循环回首条", () => {
    const { scheduler, rotator, texts } = setup();
    rotator.start();
    for (let round = 1; round <= 5; round += 1) {
      scheduler.fireInterval();
      scheduler.fireTimeout();
      expect(texts[round]).toBe(TIPS[round % TIPS.length]);
    }
    expect(texts).toEqual(["一", "二", "三", "四", "一", "二"]);
  });

  it("anim 窗口未结束时下一次 interval 重置切换（单 timeout 语义）", () => {
    const { scheduler, rotator, texts } = setup();
    rotator.start();
    // 连续两次 interval 都先到（anim 一直未提交）：只应挂一个待提交 timeout。
    scheduler.fireInterval();
    scheduler.fireInterval();
    expect(scheduler.timeoutCount).toBe(1);
    scheduler.fireTimeout();
    // 提交的是最新一条（第二条 interval 推进的序号）。
    expect(texts).toEqual(["一", "三"]);
  });

  it("空提示集：不显示任何文案、不排程", () => {
    const { scheduler, rotator, texts } = setup([]);
    rotator.start();
    expect(texts).toEqual([]);
    expect(scheduler.intervalCount).toBe(0);
  });

  it("单条提示：显示后不再排程轮换", () => {
    const { scheduler, rotator, texts } = setup(["唯一"]);
    rotator.start();
    expect(texts).toEqual(["唯一"]);
    expect(scheduler.intervalCount).toBe(0);
  });

  it("stop 清空排程：interval 不再推进", () => {
    const { scheduler, rotator, texts, hidden } = setup();
    rotator.start();
    scheduler.fireInterval();
    scheduler.fireTimeout();
    rotator.stop();
    expect(scheduler.intervalCount).toBe(0);
    expect(scheduler.timeoutCount).toBe(0);
    expect(hidden.at(-1)).toBe(false);
    const before = texts.length;
    scheduler.fireInterval(); // 无排程：不应产生任何效果
    expect(texts.length).toBe(before);
  });

  it("start 重复调用幂等（不重置、不重复排程）", () => {
    const { scheduler, rotator, texts } = setup();
    rotator.start();
    rotator.start();
    expect(texts).toEqual(["一"]);
    expect(scheduler.intervalCount).toBe(1);
  });
});

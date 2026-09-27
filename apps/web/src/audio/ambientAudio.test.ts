import { describe, expect, it } from "vitest";
import {
  ambientAudioState,
  applyAmbientVolume,
  resetAmbientAudioForTest,
  startAmbientAudio,
  volumeToGain,
} from "./ambientAudio";

describe("环境音引擎（音量设置项的真实效果）", () => {
  it("音量 → 主增益感知映射：0 静音、100 ≈ 0.5 上限、单调递增", () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(100)).toBeCloseTo(0.5, 10);
    expect(volumeToGain(50)).toBeLessThan(volumeToGain(80));
    expect(volumeToGain(80)).toBeLessThan(volumeToGain(100));
  });

  it("越界/非有限值按钳制处理（负数→0，>100→100，NaN/∞→0）", () => {
    expect(volumeToGain(-20)).toBe(0);
    expect(volumeToGain(150)).toBeCloseTo(0.5, 10);
    expect(volumeToGain(Number.NaN)).toBe(0);
    expect(volumeToGain(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("node 环境无 window：启动/调音为静默 no-op，不抛异常", () => {
    resetAmbientAudioForTest();
    expect(() => startAmbientAudio(80)).not.toThrow();
    expect(() => applyAmbientVolume(30)).not.toThrow();
    expect(ambientAudioState()).toEqual({ started: true, engineReady: false });

    resetAmbientAudioForTest();
    expect(ambientAudioState().started).toBe(false);
  });
});

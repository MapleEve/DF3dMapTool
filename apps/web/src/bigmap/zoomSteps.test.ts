import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM_INDEX,
  MIN_ZOOM_INDEX,
  nearestStepIndex,
  nextStepIndex,
  stepZoom,
  ZOOM_STEPS,
} from './zoomSteps';

describe('大地图档位化缩放', () => {
  it('档位表单调递增且端点序号正确', () => {
    expect(ZOOM_STEPS.length).toBeGreaterThan(1);
    for (let index = 1; index < ZOOM_STEPS.length; index += 1) {
      expect(ZOOM_STEPS[index]!).toBeGreaterThan(ZOOM_STEPS[index - 1]!);
    }
    expect(MIN_ZOOM_INDEX).toBe(0);
    expect(MAX_ZOOM_INDEX).toBe(ZOOM_STEPS.length - 1);
    expect(stepZoom(MIN_ZOOM_INDEX)).toBe(ZOOM_STEPS[0]);
    expect(stepZoom(MAX_ZOOM_INDEX)).toBe(ZOOM_STEPS[MAX_ZOOM_INDEX]);
  });

  it('stepZoom 越界夹取（滑杆两端继续拖拽不越界）', () => {
    expect(stepZoom(-3)).toBe(ZOOM_STEPS[0]);
    expect(stepZoom(99)).toBe(ZOOM_STEPS[MAX_ZOOM_INDEX]);
    // 非整数输入四舍五入到档位。
    expect(stepZoom(1.4)).toBe(ZOOM_STEPS[1]);
  });

  it('nearestStepIndex 把任意缩放值吸附到最近档位（滚轮连续量→档位）', () => {
    expect(nearestStepIndex(1)).toBe(0);
    expect(nearestStepIndex(1.05)).toBe(0);
    expect(nearestStepIndex(1.4)).toBe(1);
    expect(nearestStepIndex(2.7)).toBe(3);
    expect(nearestStepIndex(100)).toBe(MAX_ZOOM_INDEX);
  });

  it('nextStepIndex 逐档步进：按钮/滚轮每次只跨一档', () => {
    expect(nextStepIndex(1, 1)).toBe(1);
    expect(nextStepIndex(ZOOM_STEPS[1]!, 1)).toBe(2);
    expect(nextStepIndex(ZOOM_STEPS[1]!, -1)).toBe(0);
  });

  it('nextStepIndex 端点停驻：最大档放大与最小档缩小都停在原档', () => {
    expect(nextStepIndex(ZOOM_STEPS[MAX_ZOOM_INDEX]!, 1)).toBe(MAX_ZOOM_INDEX);
    expect(nextStepIndex(ZOOM_STEPS[MIN_ZOOM_INDEX]!, -1)).toBe(MIN_ZOOM_INDEX);
  });

  it('nextStepIndex 先吸附再步进：连续滚轮量（如 1.2）不跳档', () => {
    // 1.2 最近档是 1（索引 0），放大一步到索引 1。
    expect(nextStepIndex(1.2, 1)).toBe(1);
    // 2.7 最近档是 3（索引 3），缩小一步到索引 2。
    expect(nextStepIndex(2.7, -1)).toBe(2);
  });
});

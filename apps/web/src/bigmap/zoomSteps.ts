/**
 * 大地图档位化缩放（对齐原 2DBigMap 缩放交互：m_MapScaleAddBtn/m_MapScaleMinusBtn
 * 步进按钮 + m_MapScaleSlider 比例尺滑杆；SetZoom 运行时夹取语义）。
 *
 * 缩放档位为固定阶梯：滚轮、+/- 按钮与滑杆共用同一档位表，
 * 任意来源的缩放都会吸附到最近档位，保证三种输入的状态一致。
 */

/** 缩放档位表（相对“适配窗口”基准的倍数，单调递增）。 */
export const ZOOM_STEPS: readonly number[] = [1, 1.5, 2, 3, 4, 6, 8];

export const MIN_ZOOM_INDEX = 0;
export const MAX_ZOOM_INDEX = ZOOM_STEPS.length - 1;

/** 档位序号 → 缩放倍数（越界夹取）。 */
export function stepZoom(index: number): number {
  const clamped = Math.min(MAX_ZOOM_INDEX, Math.max(MIN_ZOOM_INDEX, Math.round(index)));
  return ZOOM_STEPS[clamped] ?? ZOOM_STEPS[MIN_ZOOM_INDEX]!;
}

/** 任意缩放值 → 最近档位序号（滑杆/滚轮吸附用）。 */
export function nearestStepIndex(zoom: number): number {
  let best = MIN_ZOOM_INDEX;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < ZOOM_STEPS.length; index += 1) {
    const distance = Math.abs((ZOOM_STEPS[index] ?? 1) - zoom);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

/**
 * 当前缩放的下一档（direction=1 放大 / -1 缩小）。
 * 先把任意当前值吸附到最近档位，再取严格上/下一档；
 * 已在端点时停在端点（返回当前档）。
 */
export function nextStepIndex(zoom: number, direction: 1 | -1): number {
  const current = nearestStepIndex(zoom);
  return Math.min(MAX_ZOOM_INDEX, Math.max(MIN_ZOOM_INDEX, current + direction));
}

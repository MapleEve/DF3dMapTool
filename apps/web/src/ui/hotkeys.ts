/**
 * 全局热键判定：单键热键（无组合键修饰）且焦点不在文本输入类控件上时生效。
 * 与引擎键位（F 交互 / R 回出生点等 HUD 常驻键位提示）共用同一口径。
 */

/** 热键事件的最小形态（测试环境可用普通对象模拟）。 */
export interface HotkeyEventLike {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly target?: unknown;
}

/** 文本输入类目标：聚焦时按键应落入输入框/下拉框而非全局热键。 */
function isTextEntryTarget(target: unknown): boolean {
  if (typeof target !== "object" || target === null) {
    return false;
  }
  const tag = (target as { readonly tagName?: unknown }).tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * 判定某次键盘事件是否为指定单键热键：
 * - 键名一致（大小写不敏感）；
 * - 无 Ctrl/Meta/Alt 修饰（组合键留给浏览器/输入法）；
 * - 焦点不在文本输入类控件上（输入框内按字母键不触发）。
 */
export function isBareHotkey(event: HotkeyEventLike, key: string): boolean {
  if (event.key.toLowerCase() !== key) {
    return false;
  }
  if (event.ctrlKey === true || event.metaKey === true || event.altKey === true) {
    return false;
  }
  return !isTextEntryTarget(event.target);
}

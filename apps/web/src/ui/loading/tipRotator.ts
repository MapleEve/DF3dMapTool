/**
 * 加载提示轮换状态机。
 *
 * 行为口径（按实测时间线复刻）：
 * - 首条提示在 start 时立即显示；
 * - 此后每 interval 毫秒切换到下一条（循环），切换方式为「先加 .hidden 类，
 *   anim 毫秒后改文案再移除类」——.hidden 本身无任何样式，即硬切换；
 * - 提示为空时不显示、不排程；单条时不排程（无从轮换）。
 *
 * 定时器经 scheduler 注入，便于单测以手动时钟驱动；缺省用全局定时器
 * （非浏览器环境返回空转实现，避免 SSR/测试装载即排程）。
 */

/** 可注入的定时器接口（句柄不透明）。 */
export interface TipScheduler {
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** 测试用手动时钟：按注册顺序保存回调，测试显式触发。 */
export class ManualScheduler implements TipScheduler {
  readonly #intervalHandlers = new Map<unknown, () => void>();
  readonly #timeoutHandlers = new Map<unknown, () => void>();
  #seq = 0;

  setInterval(handler: () => void, _ms: number): unknown {
    const handle = { kind: "interval", id: this.#seq++ };
    this.#intervalHandlers.set(handle, handler);
    return handle;
  }

  clearInterval(handle: unknown): void {
    this.#intervalHandlers.delete(handle);
  }

  setTimeout(handler: () => void, _ms: number): unknown {
    const handle = { kind: "timeout", id: this.#seq++ };
    this.#timeoutHandlers.set(handle, handler);
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.#timeoutHandlers.delete(handle);
  }

  /** 触发一个未取消的 interval 回调（缺省第一个）。 */
  fireInterval(index = 0): void {
    const handler = [...this.#intervalHandlers.values()][index];
    if (handler !== undefined) {
      handler();
    }
  }

  /** 触发一个未取消的 timeout 回调（缺省第一个；触发后移除，对齐一次性语义）。 */
  fireTimeout(index = 0): void {
    const key = [...this.#timeoutHandlers.keys()][index];
    if (key !== undefined) {
      const handler = this.#timeoutHandlers.get(key);
      this.#timeoutHandlers.delete(key);
      handler?.();
    }
  }

  get intervalCount(): number {
    return this.#intervalHandlers.size;
  }

  get timeoutCount(): number {
    return this.#timeoutHandlers.size;
  }
}

/** 浏览器全局定时器 scheduler（无 window 环境返回空转实现）。 */
export function createDefaultScheduler(): TipScheduler {
  if (typeof window === "undefined") {
    return {
      setInterval: () => null,
      clearInterval: () => undefined,
      setTimeout: () => null,
      clearTimeout: () => undefined,
    };
  }
  return {
    setInterval: (handler, ms) => window.setInterval(handler, ms),
    clearInterval: (handle) => window.clearInterval(handle as number),
    setTimeout: (handler, ms) => window.setTimeout(handler, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  };
}

export interface TipRotatorOptions {
  readonly tips: readonly string[];
  /** 轮换间隔（毫秒）。 */
  readonly intervalMs: number;
  /** 切换动画窗口（毫秒）：interval 到点后延迟这么久才改文案。 */
  readonly animMs: number;
  /** 文案变化回调（start 时与每次切换提交时各触发一次）。 */
  readonly onText: (text: string) => void;
  /** .hidden 类状态回调（切换窗口内置 true，文案提交后回 false）。 */
  readonly onHiddenChange?: (hidden: boolean) => void;
  readonly scheduler?: TipScheduler;
}

export interface TipRotator {
  start(): void;
  stop(): void;
}

/** 创建提示轮换器；同一实例可重复 start（先复位再排程）。 */
export function createTipRotator(options: TipRotatorOptions): TipRotator {
  const {
    tips,
    intervalMs,
    animMs,
    onText,
    onHiddenChange,
    scheduler = createDefaultScheduler(),
  } = options;
  let intervalHandle: unknown = null;
  let timeoutHandle: unknown = null;
  let index = 0;
  let running = false;

  const clearTimers = (): void => {
    if (intervalHandle !== null) {
      scheduler.clearInterval(intervalHandle);
      intervalHandle = null;
    }
    if (timeoutHandle !== null) {
      scheduler.clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  };

  return {
    start() {
      if (running) {
        return;
      }
      running = true;
      index = 0;
      if (tips.length === 0) {
        return;
      }
      onText(tips[0]!);
      if (tips.length <= 1) {
        return;
      }
      intervalHandle = scheduler.setInterval(() => {
        index = (index + 1) % tips.length;
        onHiddenChange?.(true);
        if (timeoutHandle !== null) {
          scheduler.clearTimeout(timeoutHandle);
        }
        timeoutHandle = scheduler.setTimeout(() => {
          timeoutHandle = null;
          onText(tips[index]!);
          onHiddenChange?.(false);
        }, animMs);
      }, intervalMs);
    },
    stop() {
      running = false;
      clearTimers();
      onHiddenChange?.(false);
    },
  };
}

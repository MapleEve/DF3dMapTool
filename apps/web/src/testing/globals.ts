/**
 * 运行时无关的全局桩：vi.stubGlobal / vi.unstubAllGlobals 是 vitest 的私有 API，
 * bun:test 的 vi 不提供；这里以直接赋值实现同一语义，两种测试运行器通用。
 */

const restores: Array<() => void> = [];

/** 以 value 覆盖 globalThis 上的属性，unstubAllGlobals 时按 LIFO 恢复原值。 */
export function stubGlobal(key: string, value: unknown): void {
  const target = globalThis as Record<string, unknown>;
  const had = key in target;
  const original = target[key];
  restores.push(() => {
    if (had) {
      target[key] = original;
    } else {
      delete target[key];
    }
  });
  target[key] = value;
}

/** 恢复全部 stubGlobal 覆盖（后装先卸）。 */
export function unstubAllGlobals(): void {
  while (restores.length > 0) {
    restores.pop()!();
  }
}

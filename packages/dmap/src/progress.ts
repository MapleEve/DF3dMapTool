/**
 * 跨流加载进度聚合器。
 *
 * 分块加载是多个并行流（并发池），每条流完成一个分块时上报其实例份额；
 * 聚合器把各流份额加总为「已载实例 / 总实例」的进度分数。
 * 分块卸载（离开渲染半径）以负份额上报，分数相应回落，始终夹在 [0, 1]。
 */
export class StreamProgressAggregator {
  readonly #total: number;
  #loaded = 0;

  constructor(total: number) {
    if (!Number.isFinite(total) || total <= 0) {
      throw new RangeError(`total 必须为正数，实际: ${total}`);
    }
    this.#total = total;
  }

  /** 全部流的份额总和（分块卸载后可能回落）。 */
  get loaded(): number {
    return this.#loaded;
  }

  /** 份额总数。 */
  get total(): number {
    return this.#total;
  }

  /** 聚合分数：已载实例 / 总实例，夹在 [0, 1]。 */
  get fraction(): number {
    return Math.min(1, Math.max(0, this.#loaded / this.#total));
  }

  /**
   * 上报一个流的份额（正=载入、负=卸载），返回上报后的聚合分数。
   * 份额使已载总数越界时按分数夹取处理（loaded 本身不做钳制，便于审计）。
   */
  report(share: number): number {
    if (!Number.isFinite(share)) {
      throw new RangeError(`share 必须为有限数值，实际: ${share}`);
    }
    this.#loaded += share;
    return this.fraction;
  }
}

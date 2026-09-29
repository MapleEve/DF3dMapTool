/**
 * 帧预算装配队列：把「容器载荷 → 场景装配」的收尾工作从容器完成回调的
 * 微任务级联里挪出来，按帧预算分摊到渲染帧之间执行。
 *
 * 背景：分块容器拉取完成后，解析（GLB→场景对象）与装配（按层拆分/注册/
 * 旧层释放）原本衔接在解码完成回调的微任务级联里执行；批量换层（集中
 * 升级/降级）时多个容器的收尾在同一任务窗内串联，主线程出现长任务。
 *
 * 队列按条目状态机推进：
 * - queued（载荷就绪，解析未启动）→ parsing（解析中，等待解码）→
 *   ready（场景已解析，待装配）→ 装配完成出队；
 * - 每次排空（tick）在预算内至少推进一项：先装配 ready 条目（FIFO），
 *   再用剩余预算启动 queued 条目的解析；解析的完成回调只翻转状态并
 *   请求下一次排空，不在回调里做装配工作；
 * - 解析流水线在途（parsing + ready）达到闸门时暂停启动新解析：
 *   控制已解析场景的内存驻留，并错开解码完成回调的到达节奏；
 * - 条目可声明失效（isStale，如分块离开应载集/层已过期）：排空时机会性
 *   清扫出队，解析完成后才发现失效的场景由 drop 释放，不泄漏；
 * - 调度器可注入：浏览器缺省对齐 rAF（与渲染帧合帧出图），无 rAF 的
 *   运行时（测试/headless）退化为 setTimeout，测试可直接注入同步调度器。
 */
export interface AssemblyJob<S> {
  /** 解析层载荷为场景对象（同步段小；Draco 解码在 Worker，完成异步）。 */
  readonly parse: () => Promise<S>;
  /** 装配段（拆分/注册/挂载/旧层释放），在排空 tick 的预算内执行。 */
  readonly finalize: (scene: S) => void;
  /** 解析失败处理（与拉取失败同构的失败冷却路径）。 */
  readonly onParseError: (error: unknown) => void;
  /** 条目被丢弃时释放资源；scene 非 null 表示解析已完成（释放场景对象）。 */
  readonly drop: (scene: S | null) => void;
  /** 机会性失效检查（每次排空前调用；true = 丢弃条目）。 */
  readonly isStale: () => boolean;
}

/** 排空调度器：收到回调后应尽快执行 run（幂等去重由队列内部保证）。 */
export type AssemblyScheduler = (run: () => void) => void;

export interface AssemblyQueueOptions {
  /** 单次排空的帧预算（毫秒）；预算内「至少推进一项」。缺省 6。 */
  readonly budgetMs?: number;
  /** 排空调度器；缺省 rAF，无 rAF 环境退化为 setTimeout(0)。 */
  readonly scheduler?: AssemblyScheduler;
  /** 时钟（预算计量）；缺省 performance.now，测试可注入假时钟。 */
  readonly now?: () => number;
  /** 解析流水线积压上限（parsing + ready 条目数）：超过后暂停启动新解析，
   *  既控制已解析场景的内存驻留，也错开解码完成回调的到达节奏。缺省 4。 */
  readonly maxInFlightParses?: number;
}

interface AssemblyItem<S> {
  readonly job: AssemblyJob<S>;
  state: "queued" | "parsing" | "ready";
  scene: S | null;
}

const DEFAULT_BUDGET_MS = 6;
const DEFAULT_MAX_IN_FLIGHT_PARSES = 4;

/** 缺省调度器：浏览器对齐渲染帧，非浏览器环境（测试/headless）退化为立即排空。 */
export const defaultAssemblyScheduler: AssemblyScheduler = (run) => {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(run);
  } else {
    setTimeout(run, 0);
  }
};

export class AssemblyQueue<S> {
  readonly #items: AssemblyItem<S>[] = [];
  readonly #budgetMs: number;
  readonly #maxInFlightParses: number;
  readonly #scheduler: AssemblyScheduler;
  readonly #now: () => number;
  #scheduled = false;
  #disposed = false;

  constructor(options: AssemblyQueueOptions = {}) {
    this.#budgetMs = Math.max(0, options.budgetMs ?? DEFAULT_BUDGET_MS);
    this.#maxInFlightParses = Math.max(
      1,
      options.maxInFlightParses ?? DEFAULT_MAX_IN_FLIGHT_PARSES,
    );
    this.#scheduler = options.scheduler ?? defaultAssemblyScheduler;
    this.#now = options.now ?? (() => performance.now());
  }

  /** 未完成条目数（queued + parsing + ready）。 */
  get pendingCount(): number {
    return this.#items.length;
  }

  /** 已解析待装配（ready）的条目数。 */
  get readyBacklog(): number {
    let count = 0;
    for (const item of this.#items) {
      if (item.state === "ready") {
        count += 1;
      }
    }
    return count;
  }

  /** 解析流水线在途数（parsing + ready）：装配出队后回落。 */
  get inFlightParses(): number {
    let count = 0;
    for (const item of this.#items) {
      if (item.state !== "queued") {
        count += 1;
      }
    }
    return count;
  }

  /** 入队一个装配任务；队列已释放时立即丢弃（drop(null)）。 */
  enqueue(job: AssemblyJob<S>): void {
    if (this.#disposed) {
      job.drop(null);
      return;
    }
    this.#items.push({ job, state: "queued", scene: null });
    this.#requestTick();
  }

  /**
   * 排空一步：失效清扫 → 预算内装配 ready 条目 → 剩余预算启动解析。
   * 预算内至少推进一项（装配或解析启动各至少一项，若存在）。
   * 返回是否仍有未完成条目。帧循环可直接调用（幂等、开销恒定）。
   */
  tick(): boolean {
    if (this.#disposed || this.#items.length === 0) {
      return false;
    }
    // 1. 失效清扫：条目声明已离开应载集/层已过期 → 立即出队释放
    //    （parsing 条目出队后，其解析完成回调自行 drop 场景）。
    for (let index = this.#items.length - 1; index >= 0; index -= 1) {
      const item = this.#items[index]!;
      if (item.job.isStale()) {
        this.#items.splice(index, 1);
        item.job.drop(item.scene);
      }
    }
    const started = this.#now();
    // 2. 预算内装配 ready 条目（FIFO；至少一项，其后按预算退出）。
    //    装配内部仍会复核挂载条件（应载集/层规则），过期场景就地释放。
    let finalizedAny = false;
    for (;;) {
      const index = this.#items.findIndex((item) => item.state === "ready");
      if (index < 0) {
        break;
      }
      if (finalizedAny && this.#now() - started >= this.#budgetMs) {
        break;
      }
      const item = this.#items.splice(index, 1)[0]!;
      finalizedAny = true;
      item.job.finalize(item.scene!);
    }
    // 3. 剩余预算启动解析；解析流水线在途（parsing + ready）达到闸门后暂停：
    //    控制已解析场景的内存驻留，并错开解码完成回调的到达节奏。
    //    条目不出队：parsing 期间仍在队内（失效清扫/换图清理可见），
    //    解析完成回调据此把状态翻转为 ready。
    let startedAny = false;
    for (;;) {
      if (this.inFlightParses >= this.#maxInFlightParses) {
        break;
      }
      const index = this.#items.findIndex((item) => item.state === "queued");
      if (index < 0) {
        break;
      }
      if (startedAny && this.#now() - started >= this.#budgetMs) {
        break;
      }
      startedAny = true;
      this.#startParse(this.#items[index]!);
    }
    if (this.#items.length > 0 && this.#hasActionableItem()) {
      this.#requestTick();
    }
    return this.#items.length > 0;
  }

  /** 丢弃全部条目（换图/释放）；parsing 条目的解析完成后自行释放场景。 */
  clear(): void {
    const dropped = this.#items.splice(0, this.#items.length);
    for (const item of dropped) {
      item.job.drop(item.scene);
    }
  }

  /** 终态释放：清空并不再接受新条目。 */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.clear();
  }

  #startParse(item: AssemblyItem<S>): void {
    item.state = "parsing";
    let pending: Promise<S>;
    try {
      pending = item.job.parse();
    } catch (error) {
      // parse 同步抛出（如载荷头校验失败）按解析失败处理。
      this.#remove(item);
      item.job.onParseError(error);
      this.#requestTick();
      return;
    }
    pending.then(
      (scene) => {
        if (this.#disposed || !this.#includes(item)) {
          // 排空清扫/换图清理期间解析完成：释放场景防泄漏。
          item.job.drop(scene);
          return;
        }
        item.scene = scene;
        item.state = "ready";
        this.#requestTick();
      },
      (error: unknown) => {
        if (this.#disposed || !this.#includes(item)) {
          return;
        }
        this.#remove(item);
        item.job.onParseError(error);
        this.#requestTick();
      },
    );
  }

  #hasActionableItem(): boolean {
    return this.#items.some((item) => item.state !== "parsing");
  }

  #includes(item: AssemblyItem<S>): boolean {
    return this.#items.includes(item);
  }

  #remove(item: AssemblyItem<S>): void {
    const index = this.#items.indexOf(item);
    if (index >= 0) {
      this.#items.splice(index, 1);
    }
  }

  #requestTick(): void {
    if (this.#scheduled || this.#disposed) {
      return;
    }
    this.#scheduled = true;
    this.#scheduler(() => {
      this.#scheduled = false;
      this.tick();
    });
  }
}

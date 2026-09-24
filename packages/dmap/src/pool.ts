/**
 * 受限并发任务池：分块容器的并行拉取调度。
 *
 * - **排序**：任务携带优先级（数值越小越先执行，典型为到视线中心的距离），
 *   空闲槽位总是取当前优先级最高（数值最小）的排队任务，同优先级按提交顺序；
 * - **限流**：任意时刻最多 `concurrency` 个任务在执行；
 * - **重试**：任务失败后按原优先级自动重试（默认附加 1 次），重试前按
 *   `retryDelayMs` 指数退避（第 n 次重试等待 retryDelayMs × 2^(n-1)，
 *   等待期间保持执行态、占用并发槽位），重试仍失败才向提交方抛出最后一个错误；
 * - **去重**：相同 key 的任务在排队/执行期间重复提交时复用同一次执行。
 */

export interface TaskPoolOptions {
  /** 最大并发执行数（≥1）。 */
  readonly concurrency: number;
  /** 单任务失败后的附加尝试次数（总尝试 = 1 + retries），默认 1。 */
  readonly retries?: number;
  /** 重试前的基础退避毫秒数（默认 0 = 立即重试），按重试轮次指数放大。 */
  readonly retryDelayMs?: number;
  /** 重试前回调（日志/埋点用）。attempt 为即将进行的第几次尝试（从 2 起）。 */
  readonly onRetry?: (key: string, error: unknown, attempt: number) => void;
}

interface QueuedTask {
  readonly key: string;
  readonly priority: number;
  /** 提交序号，同优先级时保持先进先出。 */
  readonly seq: number;
  readonly start: () => void;
  readonly cancel: () => void;
}

/** 任务仍在排队即被 `clear()` 丢弃时的取消信号。 */
export class TaskCancelledError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`任务已被丢弃: ${key}`);
    this.name = "TaskCancelledError";
    this.key = key;
  }
}

export class TaskPool {
  readonly #concurrency: number;
  readonly #retries: number;
  readonly #retryDelayMs: number;
  readonly #onRetry: ((key: string, error: unknown, attempt: number) => void) | null;
  readonly #queued: QueuedTask[] = [];
  /** 执行中（含重试退避中）的任务 key。 */
  readonly #active = new Set<string>();
  /** 排队/执行中任务的 result Promise（去重用），settle 后移除。 */
  readonly #pending = new Map<string, Promise<unknown>>();
  #seq = 0;

  constructor(options: TaskPoolOptions) {
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
      throw new RangeError(`concurrency 必须为正整数，实际: ${options.concurrency}`);
    }
    this.#concurrency = options.concurrency;
    this.#retries = Math.max(0, Math.floor(options.retries ?? 1));
    this.#retryDelayMs = Math.max(0, options.retryDelayMs ?? 0);
    this.#onRetry = options.onRetry ?? null;
  }

  /** 当前排队（未开始）任务数。 */
  get queuedCount(): number {
    return this.#queued.length;
  }

  /** 当前执行中任务数。 */
  get runningCount(): number {
    return this.#active.size;
  }

  /** key 对应任务是否正在排队或执行。 */
  has(key: string): boolean {
    return this.#pending.has(key);
  }

  /**
   * 提交一个任务：按优先级排队执行，失败自动重试（`retries` 次附加尝试）。
   * 相同 key 在排队/执行期间的重复提交复用同一次执行并得到同一结果。
   * `clear()` 丢弃排队任务时，其 Promise 以 TaskCancelledError 拒绝。
   */
  submit<T>(key: string, priority: number, task: () => Promise<T>): Promise<T> {
    const existing = this.#pending.get(key);
    if (existing !== undefined) {
      return existing as Promise<T>;
    }
    let resolveResult: (value: T) => void;
    let rejectResult: (reason: unknown) => void;
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    this.#pending.set(key, result);
    const entry: QueuedTask = {
      key,
      priority,
      seq: this.#seq++,
      start: () => {
        this.#active.add(key);
        void this.#attempt(key, 1, task).then(
          (value) => {
            this.#settle(key);
            resolveResult!(value);
          },
          (error: unknown) => {
            this.#settle(key);
            rejectResult!(error);
          },
        );
      },
      cancel: () => {
        this.#pending.delete(key);
        rejectResult!(new TaskCancelledError(key));
      },
    };
    this.#queued.push(entry);
    this.#pump();
    return result;
  }

  /** 丢弃全部排队（未开始）任务；执行中的任务不受影响。 */
  clear(): void {
    const dropped = this.#queued.splice(0, this.#queued.length);
    for (const task of dropped) {
      task.cancel();
    }
  }

  #pump(): void {
    while (this.#active.size < this.#concurrency && this.#queued.length > 0) {
      // 选出优先级数值最小（最紧急）的任务；同优先级按提交顺序。
      let bestIndex = 0;
      for (let i = 1; i < this.#queued.length; i += 1) {
        const best = this.#queued[bestIndex]!;
        const candidate = this.#queued[i]!;
        if (candidate.priority < best.priority) {
          bestIndex = i;
        }
      }
      const [task] = this.#queued.splice(bestIndex, 1);
      if (task === undefined) {
        return;
      }
      task.start();
    }
  }

  #settle(key: string): void {
    this.#active.delete(key);
    this.#pending.delete(key);
    this.#pump();
  }

  async #attempt<T>(key: string, attempt: number, task: () => Promise<T>): Promise<T> {
    try {
      return await task();
    } catch (error) {
      if (attempt <= this.#retries) {
        this.#onRetry?.(key, error, attempt + 1);
        if (this.#retryDelayMs > 0) {
          // 指数退避：持续失败（如部署缺文件、断网）时避免请求风暴；
          // 等待期间任务保持执行态并占用并发槽位，防止退避放大并发。
          await sleep(this.#retryDelayMs * 2 ** (attempt - 1));
        }
        return this.#attempt(key, attempt + 1, task);
      }
      throw error;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

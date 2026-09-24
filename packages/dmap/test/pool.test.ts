import { describe, expect, it, vi } from "vitest";
import { TaskCancelledError, TaskPool } from "../src/pool.js";

/** 手动解锁的异步闸门。 */
function gate(): { wait: () => Promise<void>; open: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { wait: () => promise, open: resolve };
}

describe("TaskPool", () => {
  it("限流：并发从不超过 concurrency，槽位释放后继续", async () => {
    const pool = new TaskPool({ concurrency: 2 });
    const events: string[] = [];
    const gates = [gate(), gate(), gate(), gate()];
    const tasks = gates.map((g, i) => async () => {
      events.push(`start:${i}`);
      await g.wait();
      events.push(`end:${i}`);
    });
    const results = tasks.map((task, i) => pool.submit(`k${i}`, 0, task));
    // 提交后立即只有两个任务真正开跑。
    expect(events.filter((e) => e.startsWith("start:"))).toHaveLength(2);
    gates[0]!.open();
    await results[0];
    // 一个槽位释放后第三个任务开跑。
    expect(events.filter((e) => e.startsWith("start:"))).toHaveLength(3);
    gates[1]!.open();
    gates[2]!.open();
    gates[3]!.open();
    await Promise.all(results);
    expect(events.filter((e) => e.startsWith("start:"))).toHaveLength(4);
    expect(events.filter((e) => e.startsWith("end:"))).toHaveLength(4);
    expect(pool.runningCount).toBe(0);
  });

  it("排序：空闲槽位优先执行优先级数值最小的任务", async () => {
    const pool = new TaskPool({ concurrency: 1 });
    const order: number[] = [];
    const blocker = gate();
    // 先占住唯一槽位，让后续提交全部排队。
    const head = pool.submit("head", -100, async () => {
      await blocker.wait();
    });
    const submissions = [5, 1, 3].map((priority, index) =>
      pool.submit(`k${index}`, priority, async () => {
        order.push(priority);
      }),
    );
    blocker.open();
    await head;
    await Promise.all(submissions);
    expect(order).toEqual([1, 3, 5]);
  });

  it("同优先级按提交顺序（FIFO）执行", async () => {
    const pool = new TaskPool({ concurrency: 1 });
    const order: string[] = [];
    const blocker = gate();
    const head = pool.submit("head", 0, async () => {
      await blocker.wait();
    });
    const submissions = ["a", "b", "c"].map((key) =>
      pool.submit(key, 7, async () => {
        order.push(key);
      }),
    );
    blocker.open();
    await head;
    await Promise.all(submissions);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("重试：首次失败自动附加一次尝试并最终成功", async () => {
    const onRetry = vi.fn();
    const pool = new TaskPool({ concurrency: 1, retries: 1, onRetry });
    let attempts = 0;
    const task = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("transient");
      }
      return "ok";
    });
    await expect(pool.submit("k", 0, task)).resolves.toBe("ok");
    expect(attempts).toBe(2);
    expect(task).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith("k", expect.any(Error), 2);
  });

  it("重试耗尽：附加尝试仍失败则拒绝并抛最后一次错误", async () => {
    const pool = new TaskPool({ concurrency: 1, retries: 1 });
    const task = vi.fn(async () => {
      throw new Error("down");
    });
    await expect(pool.submit("k", 0, task)).rejects.toThrow("down");
    expect(task).toHaveBeenCalledTimes(2);
    // 失败任务结算后不再占用 key：可再次提交。
    expect(pool.has("k")).toBe(false);
  });

  it("重试次数为 0：失败不重试", async () => {
    const pool = new TaskPool({ concurrency: 1, retries: 0 });
    const task = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(pool.submit("k", 0, task)).rejects.toThrow("boom");
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("重试退避：retryDelayMs > 0 时下一次尝试延后执行", async () => {
    const pool = new TaskPool({ concurrency: 1, retries: 1, retryDelayMs: 40 });
    const timestamps: number[] = [];
    await expect(
      pool.submit("k", 0, async () => {
        timestamps.push(Date.now());
        if (timestamps.length === 1) {
          throw new Error("transient");
        }
        return "ok";
      }),
    ).resolves.toBe("ok");
    expect(timestamps).toHaveLength(2);
    expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(35);
  });

  it("重试退避：退避等待期间任务仍占用并发槽位", async () => {
    const pool = new TaskPool({ concurrency: 1, retries: 1, retryDelayMs: 30 });
    const blocker = pool.submit("failing", 0, async () => {
      throw new Error("down");
    });
    // 唯一槽位被失败任务的退避等待占住：排队任务不得提前开跑。
    const queued = pool.submit("queued", 0, async () => "later");
    await expect(blocker).rejects.toThrow("down");
    await expect(queued).resolves.toBe("later");
  });

  it("去重：相同 key 在排队/执行期间复用同一次执行", async () => {
    const pool = new TaskPool({ concurrency: 1 });
    const task = vi.fn(async () => "other");
    const blocker = gate();
    const first = pool.submit("k", 0, async () => {
      await blocker.wait();
      return "shared";
    });
    const second = pool.submit("k", 5, task);
    expect(second).toBe(first);
    blocker.open();
    await expect(first).resolves.toBe("shared");
    expect(task).not.toHaveBeenCalled();
  });

  it("clear：排队任务被丢弃并以 TaskCancelledError 拒绝，执行中不受影响", async () => {
    const pool = new TaskPool({ concurrency: 1 });
    const blocker = gate();
    const running = pool.submit("running", 0, async () => {
      await blocker.wait();
      return 1;
    });
    const queued = pool.submit("queued", 1, async () => 2);
    expect(pool.queuedCount).toBe(1);
    pool.clear();
    await expect(queued).rejects.toBeInstanceOf(TaskCancelledError);
    expect(pool.has("queued")).toBe(false);
    blocker.open();
    await expect(running).resolves.toBe(1);
  });

  it("并发完成后池状态归零", async () => {
    const pool = new TaskPool({ concurrency: 3 });
    await Promise.all(Array.from({ length: 5 }, (_, i) => pool.submit(`k${i}`, i, async () => i)));
    expect(pool.queuedCount).toBe(0);
    expect(pool.runningCount).toBe(0);
  });

  it("非法并发数拒绝构造", () => {
    expect(() => new TaskPool({ concurrency: 0 })).toThrow(RangeError);
    expect(() => new TaskPool({ concurrency: 1.5 })).toThrow(RangeError);
  });

  it("同步抛错的任务同样走重试路径", async () => {
    const pool = new TaskPool({ concurrency: 1, retries: 1 });
    let attempts = 0;
    const value = await pool.submit("k", 0, () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("sync throw");
      }
      return Promise.resolve("recovered");
    });
    expect(value).toBe("recovered");
    expect(attempts).toBe(2);
  });
});

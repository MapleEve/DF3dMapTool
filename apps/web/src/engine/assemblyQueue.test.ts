import { describe, expect, it } from "vitest";
import { AssemblyQueue, type AssemblyJob, type AssemblyScheduler } from "./assemblyQueue";

/**
 * 帧预算装配队列单元测试：预算计量（假时钟）、ready 积压闸门、失效清扫、
 * 取消联动（离开应载集的条目丢弃且不泄漏）、解析失败路径、调度器注入。
 *
 * 排空节奏：手动调度器不自动执行，测试用 flush() 显式驱动每一次排空，
 * 用假时钟精确控制预算判定（finalize/parse 启动的模拟耗时推进时钟）。
 */

/** 测试级假时钟（作业的模拟耗时推进它）。 */
const clock = { now: 0 };

interface Recorder {
  readonly events: string[];
  parseStartCount: number;
  finalizeCount: number;
  dropCount: number;
  dropSceneCount: number;
}

interface JobSpec {
  readonly name: string;
  /** finalize 的模拟耗时（推进假时钟）。 */
  readonly finalizeCostMs?: number;
  /** parse 启动（同步段）的模拟耗时（推进假时钟）。 */
  readonly parseCostMs?: number;
  /** 覆盖失效判定。 */
  readonly stale?: () => boolean;
  /** parse 以拒绝结束。 */
  readonly rejectParse?: boolean;
}

function makeRecorder(): Recorder {
  return { events: [], parseStartCount: 0, finalizeCount: 0, dropCount: 0, dropSceneCount: 0 };
}

/** 手动调度器：不自动执行；flush() 每次只执行一个已捕获的排空请求
 *  （一次 flush = 一次排空，精确控制预算窗口；tick 内再请求的排空留待下次 flush）。 */
function manualScheduler(): {
  readonly scheduler: AssemblyScheduler;
  flush(): boolean;
} {
  const pending: (() => void)[] = [];
  return {
    scheduler: (run) => {
      pending.push(run);
    },
    flush() {
      const run = pending.shift();
      if (run === undefined) {
        return false;
      }
      run();
      return true;
    },
  };
}

function jobOf(recorder: Recorder, spec: JobSpec): AssemblyJob<{ id: string }> {
  return {
    parse: () => {
      recorder.parseStartCount += 1;
      if (spec.parseCostMs !== undefined) {
        clock.now += spec.parseCostMs;
      }
      recorder.events.push(`parse:${spec.name}`);
      if (spec.rejectParse === true) {
        return Promise.reject(new Error(`parse-fail:${spec.name}`));
      }
      return Promise.resolve({ id: spec.name });
    },
    finalize: (scene) => {
      recorder.finalizeCount += 1;
      if (spec.finalizeCostMs !== undefined) {
        clock.now += spec.finalizeCostMs;
      }
      recorder.events.push(`finalize:${scene.id}`);
    },
    onParseError: (error) => {
      recorder.events.push(`error:${spec.name}:${(error as Error).message}`);
    },
    drop: (scene) => {
      recorder.dropCount += 1;
      if (scene !== null) {
        recorder.dropSceneCount += 1;
        recorder.events.push(`drop-scene:${scene.id}`);
      } else {
        recorder.events.push("drop-null");
      }
    },
    isStale: () => spec.stale?.() ?? false,
  };
}

function queueOf(options: { budgetMs?: number; maxInFlightParses?: number } = {}) {
  const manual = manualScheduler();
  const queue = new AssemblyQueue<{ id: string }>({
    budgetMs: options.budgetMs ?? 6,
    maxInFlightParses: options.maxInFlightParses,
    scheduler: manual.scheduler,
    now: () => clock.now,
  });
  return { queue, manual };
}

/** 等微任务排空（parse promise 链翻转状态）。 */
const settleMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("AssemblyQueue · 帧预算与顺序", () => {
  it("装配预算：至少装配一项，超预算后剩余 ready 条目留待下次排空", async () => {
    const recorder = makeRecorder();
    clock.now = 0;
    const { queue, manual } = queueOf({ budgetMs: 10 });
    queue.enqueue(jobOf(recorder, { name: "a", finalizeCostMs: 6 }));
    queue.enqueue(jobOf(recorder, { name: "b", finalizeCostMs: 6 }));
    queue.enqueue(jobOf(recorder, { name: "c", finalizeCostMs: 6 }));

    manual.flush(); // 排空 1：启动全部解析（同步段 0ms，闸门 4 内）
    await settleMicrotasks(); // 三条全部 ready
    manual.flush(); // 排空 2：装配 a(+6ms)、b(+6ms) 后 12ms ≥ 10ms，c 留队
    expect(recorder.events.filter((e) => e.startsWith("finalize:"))).toEqual([
      "finalize:a",
      "finalize:b",
    ]);
    expect(queue.pendingCount).toBe(1);

    manual.flush(); // 排空 3：装配 c
    expect(recorder.events.filter((e) => e.startsWith("finalize:"))).toEqual([
      "finalize:a",
      "finalize:b",
      "finalize:c",
    ]);
    expect(queue.pendingCount).toBe(0);
  });

  it("解析启动也吃预算：超预算后剩余 queued 条目下次排空再启动", async () => {
    const recorder = makeRecorder();
    clock.now = 0;
    const { queue, manual } = queueOf({ budgetMs: 10 });
    queue.enqueue(jobOf(recorder, { name: "a", parseCostMs: 6 }));
    queue.enqueue(jobOf(recorder, { name: "b", parseCostMs: 6 }));
    queue.enqueue(jobOf(recorder, { name: "c", parseCostMs: 6 }));

    manual.flush(); // 排空 1：启动 a(+6ms)、b(+6ms) 后 12ms ≥ 10ms，c 不启动
    expect(recorder.events).toEqual(["parse:a", "parse:b"]);
    expect(queue.pendingCount).toBe(3);
    await settleMicrotasks();
    manual.flush(); // 排空 2：装配 a/b（finalize 0ms），再启动 c 的解析
    expect(recorder.events.filter((e) => e.startsWith("parse:"))).toEqual([
      "parse:a",
      "parse:b",
      "parse:c",
    ]);
    expect(recorder.events.filter((e) => e.startsWith("finalize:"))).toEqual([
      "finalize:a",
      "finalize:b",
    ]);
    await settleMicrotasks();
    manual.flush(); // 排空 3：装配 c
    expect(recorder.events.filter((e) => e.startsWith("finalize:"))).toEqual([
      "finalize:a",
      "finalize:b",
      "finalize:c",
    ]);
    expect(queue.pendingCount).toBe(0);
  });

  it("解析流水线闸门：在途（parsing + ready）达上限后暂停启动，装配出队后恢复", async () => {
    const recorder = makeRecorder();
    clock.now = 0;
    const { queue, manual } = queueOf({ budgetMs: 100, maxInFlightParses: 1 });
    queue.enqueue(jobOf(recorder, { name: "a" }));
    queue.enqueue(jobOf(recorder, { name: "b" }));
    queue.enqueue(jobOf(recorder, { name: "c" }));

    manual.flush(); // 闸门 1：只启动 a
    expect(recorder.parseStartCount).toBe(1);
    await settleMicrotasks();
    manual.flush(); // 装配 a（在途归零），闸门释放 → 启动 b
    expect(recorder.events).toContain("finalize:a");
    expect(recorder.parseStartCount).toBe(2);
    await settleMicrotasks();
    manual.flush(); // 装配 b → 启动 c
    expect(recorder.events).toContain("finalize:b");
    expect(recorder.parseStartCount).toBe(3);
    await settleMicrotasks();
    manual.flush();
    expect(recorder.events).toContain("finalize:c");
    expect(queue.pendingCount).toBe(0);
  });
});

describe("AssemblyQueue · 取消联动（丢弃且不泄漏）", () => {
  it("ready 条目失效清扫：带场景丢弃（drop-scene），不进入装配", async () => {
    const recorder = makeRecorder();
    clock.now = 0;
    const { queue, manual } = queueOf({ budgetMs: 100 });
    const stale = { a: false, b: false };
    queue.enqueue(jobOf(recorder, { name: "a", stale: () => stale.a }));
    queue.enqueue(jobOf(recorder, { name: "b", stale: () => stale.b }));
    manual.flush(); // 排空 1：启动全部解析
    await settleMicrotasks(); // 全部 ready（排空请求挂起，未执行）
    expect(queue.readyBacklog).toBe(2);

    stale.a = true; // a 离开应载集
    manual.flush(); // 排空 2：清扫丢弃 a（带场景），装配 b
    expect(recorder.events).toContain("drop-scene:a");
    expect(recorder.events).toContain("finalize:b");
    expect(recorder.finalizeCount).toBe(1);
    expect(queue.pendingCount).toBe(0);
  });

  it("parsing 期间失效：清扫时 drop(null)，解析完成后场景再经 drop 释放（不泄漏）", async () => {
    const recorder = makeRecorder();
    clock.now = 0;
    const { queue, manual } = queueOf({ budgetMs: 100 });
    const stale = { value: false };
    let resolveParse: ((scene: { id: string }) => void) | null = null;
    const job: AssemblyJob<{ id: string }> = {
      parse: () =>
        new Promise((resolve) => {
          resolveParse = resolve;
        }),
      finalize: () => {
        recorder.finalizeCount += 1;
      },
      onParseError: () => {
        recorder.events.push("error");
      },
      drop: (scene) => {
        recorder.dropCount += 1;
        if (scene !== null) {
          recorder.dropSceneCount += 1;
          recorder.events.push(`drop-scene:${scene.id}`);
        }
      },
      isStale: () => stale.value,
    };
    queue.enqueue(job);
    manual.flush(); // 排空 1（调度器驱动）：启动解析（挂起，未完成）
    expect(queue.pendingCount).toBe(1);

    stale.value = true;
    queue.tick(); // 帧循环直接排空：清扫 parsing 条目，drop(null)——场景尚未存在
    expect(recorder.dropCount).toBe(1);
    expect(recorder.dropSceneCount).toBe(0);
    expect(queue.pendingCount).toBe(0);

    resolveParse!({ id: "late" }); // 解析此刻才完成：场景经 drop 释放
    await settleMicrotasks();
    expect(recorder.dropCount).toBe(2);
    expect(recorder.dropSceneCount).toBe(1);
    expect(recorder.finalizeCount).toBe(0);
    queue.tick(); // 帧循环再排空：不再产生任何动作
    expect(queue.pendingCount).toBe(0);
    expect(recorder.finalizeCount).toBe(0);
  });

  it("解析失败：onParseError 且条目出队，不影响后续条目装配", async () => {
    const recorder = makeRecorder();
    clock.now = 0;
    const { queue, manual } = queueOf({ budgetMs: 100 });
    queue.enqueue(jobOf(recorder, { name: "bad", rejectParse: true }));
    queue.enqueue(jobOf(recorder, { name: "good" }));
    manual.flush();
    await settleMicrotasks();
    manual.flush();
    expect(recorder.events).toContain("error:bad:parse-fail:bad");
    expect(recorder.events).toContain("finalize:good");
    expect(queue.pendingCount).toBe(0);
  });

  it("clear 丢弃全部条目；dispose 后 enqueue 立即 drop(null)", () => {
    const recorder = makeRecorder();
    clock.now = 0;
    const { queue } = queueOf({ budgetMs: 100 });
    queue.enqueue(jobOf(recorder, { name: "a" }));
    queue.enqueue(jobOf(recorder, { name: "b" }));
    queue.clear();
    expect(recorder.dropCount).toBe(2);
    expect(recorder.dropSceneCount).toBe(0); // 均未解析
    expect(queue.pendingCount).toBe(0);

    queue.dispose();
    queue.enqueue(jobOf(recorder, { name: "late" })); // dispose 后入队 → 立即丢弃
    expect(recorder.dropCount).toBe(3);
    expect(recorder.finalizeCount).toBe(0);
  });
});

describe("AssemblyQueue · 调度器注入", () => {
  it("同步调度器：enqueue 即排空（headless/测试用）", async () => {
    const recorder = makeRecorder();
    clock.now = 0;
    const queue = new AssemblyQueue<{ id: string }>({
      budgetMs: 100,
      scheduler: (run) => {
        run();
      },
      now: () => clock.now,
    });
    queue.enqueue(jobOf(recorder, { name: "a" }));
    // enqueue → 同步排空 → 启动解析；解析完成仍是微任务。
    expect(recorder.parseStartCount).toBe(1);
    await settleMicrotasks();
    // 解析完成回调再次同步排空 → 装配完成。
    expect(recorder.events).toContain("finalize:a");
    expect(queue.pendingCount).toBe(0);
  });
});

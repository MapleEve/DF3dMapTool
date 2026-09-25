import { describe, expect, it } from "vitest";
import type { ChunkStreamStats } from "@/engine";
import {
  INDEX_PHASE_PERCENT,
  REVEAL_STALL_TIMEOUT_MS,
  advanceSceneProgress,
  initialSceneProgressState,
  type SceneProgressSnapshot,
} from "./progressMapping";

function stats(loadedChunks: number, pendingChunks: number): ChunkStreamStats {
  return {
    loadedChunks,
    pendingChunks,
    totalChunks: loadedChunks + pendingChunks + 4,
    loadedInstances: loadedChunks * 10,
    totalInstances: 1000,
    fraction: 0,
    failedChunks: 0,
  };
}

function snapshot(partial: Partial<SceneProgressSnapshot>): SceneProgressSnapshot {
  return {
    loadSeq: 0,
    status: "loading",
    indexFraction: 0,
    stats: null,
    nowMs: 0,
    ...partial,
  };
}

describe("进图进度映射", () => {
  it("索引阶段：进度 = indexFraction × 索引权重", () => {
    const state = initialSceneProgressState(snapshot({ status: "loading", indexFraction: 0.5 }));
    expect(state.percent).toBe(Math.round(INDEX_PHASE_PERCENT * 0.5));
    expect(state.revealed).toBe(false);
  });

  it("索引完成：停在索引权重上（ready 但分块未提交）", () => {
    const state = initialSceneProgressState(snapshot({ status: "ready", indexFraction: 1 }));
    expect(state.percent).toBe(INDEX_PHASE_PERCENT);
    expect(state.revealed).toBe(false);
  });

  it("分块阶段：按已载/(已载+待载) 分块聚合推进到 100", () => {
    let state = initialSceneProgressState(snapshot({ status: "ready", stats: stats(0, 8) }));
    expect(state.percent).toBe(INDEX_PHASE_PERCENT);

    state = advanceSceneProgress(state, snapshot({ status: "ready", stats: stats(4, 4) }));
    expect(state.percent).toBe(INDEX_PHASE_PERCENT + Math.round((100 - INDEX_PHASE_PERCENT) / 2));

    state = advanceSceneProgress(state, snapshot({ status: "ready", stats: stats(8, 0) }));
    expect(state.percent).toBe(100);
    expect(state.revealed).toBe(true);
  });

  it("周期内进度单调不回退（批次中途追加提交）", () => {
    let state = initialSceneProgressState(snapshot({ status: "ready", stats: stats(6, 2) }));
    const peaked = state.percent;
    // 相机飞行导致新分块入池：分母变大、计算值回落，但显示值不回退。
    state = advanceSceneProgress(state, snapshot({ status: "ready", stats: stats(6, 6) }));
    expect(state.percent).toBe(peaked);
  });

  it("完成闩：revealed 后不再因新 pending 回到加载呈现", () => {
    let state = initialSceneProgressState(snapshot({ status: "ready", stats: stats(8, 0) }));
    expect(state.revealed).toBe(true);
    state = advanceSceneProgress(state, snapshot({ status: "ready", stats: stats(8, 4) }));
    expect(state.revealed).toBe(true);
    expect(state.percent).toBe(100);
  });

  it("换图（loadSeq 递增）开新周期：进度复位、完成闩清除", () => {
    let state = initialSceneProgressState(snapshot({ status: "ready", stats: stats(8, 0) }));
    expect(state.revealed).toBe(true);
    state = advanceSceneProgress(state, snapshot({ loadSeq: 1, status: "idle", indexFraction: 0 }));
    expect(state.loadSeq).toBe(1);
    expect(state.percent).toBe(0);
    expect(state.revealed).toBe(false);
  });

  it("idle（换图瞬帧）按索引阶段 0 计，不误判完成", () => {
    const state = initialSceneProgressState(snapshot({ status: "idle", indexFraction: 0 }));
    expect(state.percent).toBe(0);
    expect(state.revealed).toBe(false);
  });

  it("error 后状态冻结（失败呈现交由状态栏，进度不再采样）", () => {
    let state = initialSceneProgressState(snapshot({ status: "loading", indexFraction: 0.4 }));
    const frozen = advanceSceneProgress(state, snapshot({ status: "error", indexFraction: 0.9 }));
    expect(frozen).toBe(state);
  });

  it("值未变化时返回原引用（供 React 参照相等跳过渲染）", () => {
    const state = initialSceneProgressState(snapshot({ status: "ready", stats: stats(2, 6) }));
    const again = advanceSceneProgress(state, snapshot({ status: "ready", stats: stats(2, 6) }));
    expect(again).toBe(state);
  });

  it("索引下载进度只在 [0, 索引权重] 内取整", () => {
    const state = initialSceneProgressState(snapshot({ status: "loading", indexFraction: 1.5 }));
    expect(state.percent).toBe(INDEX_PHASE_PERCENT);
  });
});

describe("停滞退避（引擎/网络停滞兜底）", () => {
  it("批次 pending 长时间无前进 → 退避 revealed（进度停在当前值）", () => {
    let state = initialSceneProgressState(
      snapshot({ status: "ready", nowMs: 0, stats: stats(4, 4) }),
    );
    // 前进一拍：完成 1 块（loaded 5 pending 3）。
    state = advanceSceneProgress(
      state,
      snapshot({ status: "ready", nowMs: 1000, stats: stats(5, 3) }),
    );
    expect(state.revealed).toBe(false);
    // 之后长期无推进：超过阈值仍未排空 → 退避。
    state = advanceSceneProgress(
      state,
      snapshot({ status: "ready", nowMs: 1000 + REVEAL_STALL_TIMEOUT_MS, stats: stats(5, 3) }),
    );
    expect(state.revealed).toBe(true);
    expect(state.percent).toBeLessThan(100);
  });

  it("停滞窗口内每次前进都重置计时：正常慢速排空不触发退避", () => {
    let state = initialSceneProgressState(
      snapshot({ status: "ready", nowMs: 0, stats: stats(0, 6) }),
    );
    let now = 0;
    for (let i = 1; i <= 5; i += 1) {
      now += REVEAL_STALL_TIMEOUT_MS - 1000;
      state = advanceSceneProgress(
        state,
        snapshot({ status: "ready", nowMs: now, stats: stats(i, 6 - i) }),
      );
      expect(state.revealed).toBe(false);
    }
    // 最后一块完成：正常排空（非退避）直达 100%。
    now += REVEAL_STALL_TIMEOUT_MS - 1000;
    state = advanceSceneProgress(
      state,
      snapshot({ status: "ready", nowMs: now, stats: stats(6, 0) }),
    );
    expect(state.percent).toBe(100);
    expect(state.revealed).toBe(true);
  });

  it("批次中途新提交（pending 增）不算前进：不重置停滞计时", () => {
    let state = initialSceneProgressState(
      snapshot({ status: "ready", nowMs: 0, stats: stats(4, 4) }),
    );
    state = advanceSceneProgress(
      state,
      snapshot({ status: "ready", nowMs: 1000, stats: stats(5, 3) }),
    );
    // 相机移动追加 5 块（loaded 不变 pending 增）：非前进。
    state = advanceSceneProgress(
      state,
      snapshot({ status: "ready", nowMs: 2000, stats: stats(5, 8) }),
    );
    expect(state.revealed).toBe(false);
    state = advanceSceneProgress(
      state,
      snapshot({
        status: "ready",
        nowMs: 1000 + REVEAL_STALL_TIMEOUT_MS + 2000,
        stats: stats(5, 8),
      }),
    );
    expect(state.revealed).toBe(true);
  });
});

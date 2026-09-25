/**
 * 进图加载进度映射：把「索引先行 + 分块聚合」的加载管线映射为原站式进度呈现。
 *
 * 语义：
 * - 索引阶段（idle/loading，索引容器下载）：进度 = indexFraction × INDEX_PHASE_PERCENT，
 *   即 [0, INDEX_PHASE_PERCENT]；
 * - 分块阶段（ready，首屏分块批次流式加载）：进度 =
 *   INDEX_PHASE_PERCENT + (100 - INDEX_PHASE_PERCENT) × 已载分块 / (已载 + 待载分块)，
 *   即 [INDEX_PHASE_PERCENT, 100]；
 * - 首屏批次排空（pendingChunks 归零）即 100% 并置 revealed——此后相机移动引发的
 *   增量分块流不再回到加载呈现（完成即硬切，无渐隐）；
 * - 单个加载周期内进度单调不回退（批次中途追加提交只抬高基数，显示值不回落）；
 * - 换图/重试（loadSeq 递增）开新周期，进度从 0 重新计；
 * - 停滞退避：批次有 pending 但长时间无前进（无分块完成）时退避到流式呈现
 *   （revealed），加载屏卸载、分块继续由流式徽标呈现——兜底引擎/网络停滞，
 *   正常路径不受影响（排空即 100% 硬切）。
 */

import type { ChunkStreamStats } from "@/engine";
import type { MapLoadStatus } from "@/state/mapStore";

/** 索引阶段在总进度中占的百分数。 */
export const INDEX_PHASE_PERCENT = 30;

/** 批次停滞退避阈值（毫秒）：pending>0 且该时长内无前进则卸载加载屏。 */
export const REVEAL_STALL_TIMEOUT_MS = 20_000;

export interface SceneProgressSnapshot {
  readonly loadSeq: number;
  readonly status: MapLoadStatus;
  /** 索引容器下载进度 [0,1]（mapStore.progress）。 */
  readonly indexFraction: number;
  /** 分块流式统计（首屏批次首次提交前为 null）。 */
  readonly stats: ChunkStreamStats | null;
  /** 采样时刻（毫秒时钟；停滞判定用）。 */
  readonly nowMs: number;
}

export interface SceneProgressState {
  /** 本状态所属的加载周期（对应 mapStore.loadSeq）。 */
  readonly loadSeq: number;
  /** 呈现进度（整数百分数，周期内单调不减）。 */
  readonly percent: number;
  /** 首屏批次是否已完成（完成后不再回到加载呈现）。 */
  readonly revealed: boolean;
  /** 批次最近一次前进（已载增加/待载减少）的采样时刻。 */
  readonly lastProgressAt: number;
  /** 批次前进信号：已载×1e6−待载（任一前进方向都增大）。 */
  readonly progressKey: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function samplePercent(snapshot: SceneProgressSnapshot): number {
  if (snapshot.status === "ready") {
    const stats = snapshot.stats;
    if (stats === null || stats.pendingChunks <= 0) {
      // 索引刚就绪、分块尚未提交：停在索引阶段权重上；
      // pending 归零即首屏批次完成：直达 100。
      return stats === null ? INDEX_PHASE_PERCENT : 100;
    }
    const done = stats.loadedChunks;
    const total = done + stats.pendingChunks;
    const chunkFraction = total > 0 ? done / total : 1;
    return INDEX_PHASE_PERCENT + Math.round((100 - INDEX_PHASE_PERCENT) * chunkFraction);
  }
  // idle/loading：索引下载阶段。
  return Math.round(INDEX_PHASE_PERCENT * clamp01(snapshot.indexFraction));
}

/**
 * 推进一拍：输入最新快照，输出呈现状态。
 * 值未变化时返回 prev 引用（供 React 参照相等跳过重渲染）。
 */
export function advanceSceneProgress(
  prev: SceneProgressState,
  snapshot: SceneProgressSnapshot,
): SceneProgressState {
  // 新加载周期（换图/重试）：复位进度与完成标志，停滞计时重开。
  let base = prev;
  if (prev.loadSeq !== snapshot.loadSeq) {
    base = {
      loadSeq: snapshot.loadSeq,
      percent: 0,
      revealed: false,
      lastProgressAt: snapshot.nowMs,
      progressKey: Number.NEGATIVE_INFINITY,
    };
  }
  // 失败后冻结本周期状态（错误呈现交由状态栏，加载页已卸载，不再采样）。
  if (snapshot.status === "error") {
    return base;
  }
  const stats = snapshot.stats;
  const rawKey =
    stats === null ? base.progressKey : stats.loadedChunks * 1_000_000 - stats.pendingChunks;
  const progressed = rawKey > base.progressKey;
  const progressKey = progressed ? rawKey : base.progressKey;
  const lastProgressAt = progressed ? snapshot.nowMs : base.lastProgressAt;
  const percent = Math.max(base.percent, samplePercent(snapshot));
  const drained = snapshot.status === "ready" && stats !== null && stats.pendingChunks <= 0;
  const stalled =
    !drained &&
    snapshot.status === "ready" &&
    stats !== null &&
    stats.pendingChunks > 0 &&
    snapshot.nowMs - lastProgressAt >= REVEAL_STALL_TIMEOUT_MS;
  const revealed = base.revealed || drained || stalled;
  if (
    percent === base.percent &&
    revealed === base.revealed &&
    lastProgressAt === base.lastProgressAt
  ) {
    return base;
  }
  return { loadSeq: snapshot.loadSeq, percent, revealed, lastProgressAt, progressKey };
}

/** 以快照构造初始状态（组件挂载时的首拍）。 */
export function initialSceneProgressState(snapshot: SceneProgressSnapshot): SceneProgressState {
  return advanceSceneProgress(
    {
      loadSeq: Number.NaN,
      percent: 0,
      revealed: false,
      lastProgressAt: snapshot.nowMs,
      progressKey: Number.NEGATIVE_INFINITY,
    },
    snapshot,
  );
}

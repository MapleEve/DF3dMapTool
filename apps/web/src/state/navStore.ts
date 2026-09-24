import { create } from "zustand";
import type { Vec3 } from "@/common/geometry";

/** 导航请求状态机：idle → loading → ready / unavailable；unreachable 为寻路无解。 */
export type NavStatus = "idle" | "loading" | "ready" | "unavailable" | "unreachable";

interface NavStoreState {
  status: NavStatus;
  /** 目标显示名（POI 名）。 */
  targetLabel: string | null;
  /** 途经点序列（世界系）。 */
  path: readonly Vec3[] | null;
  /** 路径总长（米）。 */
  distance: number | null;
  /** 请求序号：视口据此识别新请求。 */
  requestSeq: number;
  /** 请求目标点（世界系）。 */
  requestTarget: Vec3 | null;
  requestPath: (target: Vec3, label: string) => void;
  setLoading: () => void;
  setReady: (path: readonly Vec3[], distance: number) => void;
  setUnreachable: () => void;
  setUnavailable: () => void;
  clear: () => void;
}

/**
 * 寻路状态：UI（POI 气泡按钮）发起请求，视口订阅执行（加载导航数据 + A*），
 * 结果回填供 3D 路径层与 HUD 使用。
 */
export const useNavStore = create<NavStoreState>()((set) => ({
  status: "idle",
  targetLabel: null,
  path: null,
  distance: null,
  requestSeq: 0,
  requestTarget: null,
  requestPath: (target, label) =>
    set((state) => ({
      status: "loading",
      targetLabel: label,
      path: null,
      distance: null,
      requestSeq: state.requestSeq + 1,
      requestTarget: target,
    })),
  setLoading: () => set({ status: "loading" }),
  setReady: (path, distance) => set({ status: "ready", path, distance }),
  setUnreachable: () => set({ status: "unreachable", path: null, distance: null }),
  setUnavailable: () => set({ status: "unavailable", path: null, distance: null }),
  clear: () =>
    set({ status: "idle", targetLabel: null, path: null, distance: null, requestTarget: null }),
}));

import { useEffect, useState } from "react";
import { useMapStore } from "@/state/mapStore";
import { useViewStore } from "@/state/viewStore";
import { useHomeStore } from "../homeStore";
import { BootLoadingScreen } from "./BootLoadingScreen";
import { MapLoadingScreen } from "./MapLoadingScreen";
import {
  advanceSceneProgress,
  initialSceneProgressState,
  type SceneProgressSnapshot,
  type SceneProgressState,
} from "./progressMapping";

/**
 * 停滞退避的心跳间隔（毫秒）：分块停滞时 store 不再推送，
 * 以此节拍重采样推进状态机（停滞判定见 progressMapping）。
 */
const STALL_HEARTBEAT_MS = 1000;

/** mapStore 快照类型（getState 的返回值）。 */
type MapStoreSnapshot = ReturnType<typeof useMapStore.getState>;

/** 首次启动加载是否已了结（地图数据就绪或失败）。 */
function isBootSettled(status: MapStoreSnapshot["status"]): boolean {
  return status === "ready" || status === "error";
}

/**
 * boot 屏解除闩：应用启动即显示 boot 屏，首次进入 ready/error 时解除（此后不再出现）。
 * 解除由 mapStore 订阅回调驱动；初始值按挂载时刻的既有状态判定。
 */
function useBootDone(): boolean {
  const [done, setDone] = useState(() => isBootSettled(useMapStore.getState().status));
  useEffect(
    () =>
      useMapStore.subscribe((state) => {
        if (isBootSettled(state.status)) {
          setDone(true);
        }
      }),
    [],
  );
  return done;
}

function snapshotFrom(store: MapStoreSnapshot): SceneProgressSnapshot {
  return {
    loadSeq: store.loadSeq,
    status: store.status,
    indexFraction: store.progress,
    stats: store.streamStats,
    nowMs: Date.now(),
  };
}

/**
 * 进图进度状态：订阅 mapStore 的每次变化（进度/流式统计/状态），
 * 用纯函数推进（单调不回退 + 完成闩 + 周期复位 + 停滞退避）；
 * 值未变时保持引用跳过重渲染。
 * 停滞场景 store 不再推送，另以固定心跳重采样兜底。
 */
function useSceneProgress(): SceneProgressState {
  const [state, setState] = useState<SceneProgressState>(() =>
    initialSceneProgressState(snapshotFrom(useMapStore.getState())),
  );
  useEffect(() => {
    const advance = () => {
      setState((prev) => advanceSceneProgress(prev, snapshotFrom(useMapStore.getState())));
    };
    const unsubscribe = useMapStore.subscribe(advance);
    const heartbeat = window.setInterval(advance, STALL_HEARTBEAT_MS);
    return () => {
      unsubscribe();
      window.clearInterval(heartbeat);
    };
  }, []);
  return state;
}

/**
 * 加载流程编排：
 * 1. 应用启动 → boot 屏（不透明渐变底，无进度指示），盖住选图屏/应用壳/画布；
 * 2. 首次地图数据就绪 → boot 屏硬切卸载，露出选图屏（常规入口）；
 *    ?map= 直进时选图屏已关，进图屏直接接棒；
 * 3. 选图屏「立即行动」后（或直进），若场景仍在加载 → 进图屏（大百分比 + 底部滑条）
 *    盖住画布；选图屏停留期间后台已排空则不再出现；
 * 4. 首屏分块批次排空（或停滞退避）→ 进图屏硬切卸载，3D 视图直接呈现。
 * 换图（loadSeq 递增）时只回到第 3 步（boot 屏是启动一次性画面）；
 * 失败（error）时两屏都卸载，露出状态栏错误提示。
 */
export function LoadingFlow() {
  const bootDone = useBootDone();
  const view = useViewStore((state) => state.view);
  const homeOpen = useHomeStore((state) => state.homeOpen);
  const status = useMapStore((state) => state.status);
  const scene = useSceneProgress();

  const showScene = bootDone && !homeOpen && view === "3d" && status !== "error" && !scene.revealed;

  return (
    <>
      {!bootDone ? <BootLoadingScreen /> : null}
      {showScene ? <MapLoadingScreen percent={scene.percent} /> : null}
    </>
  );
}

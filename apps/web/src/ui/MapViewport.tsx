import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Vec3 } from "@/common/geometry";
import { loadMapBundle, mapLoadErrorCode, readMapPoiData, type MapBundle } from "@/data";
import type { MapViewer, ScreenAnchor } from "@/engine";
import { getMapById } from "@/map";
import { MinimapHudContainer } from "@/bigmap";
import { FRAME_LIMIT_FPS, QUALITY_PIXEL_RATIO, useUiStore } from "@/state/uiStore";
import { useFloorStore } from "@/state/floorStore";
import { useMapDataStore } from "@/state/mapDataStore";
import { useMapStore } from "@/state/mapStore";
import { useNavStore } from "@/state/navStore";
import { usePoiStore } from "@/state/poiStore";
import { NavPathHud } from "./NavPathHud";
import { PoiOverlay, type PoiProjector } from "./PoiOverlay";

/** HUD 世界坐标/朝向的上报间隔（毫秒）。 */
const CAMERA_HUD_INTERVAL_MS = 200;

/**
 * 3D 视口：挂载 MapViewer（场景 + 轨道相机 + 楼层系统 + chunk 流式地图层），
 * 串联 store 与引擎：数据层负责容器下载/校验（进度与失败归类），
 * 引擎复用已解密容器做清单驱动的流式加载，相机取景/飞入由轨道相机完成。
 * three.js 引擎体量较大，按需动态加载以保证外壳首屏轻量：
 * 本组件不静态引入 three/引擎代码，仅经类型与回调对接。
 */
export function MapViewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerReadyRef = useRef<Promise<MapViewer | null> | null>(null);
  const [viewer, setViewer] = useState<MapViewer | null>(null);
  const [projector, setProjector] = useState<PoiProjector>(null);
  const mapId = useMapStore((state) => state.mapId);
  const mapStatus = useMapStore((state) => state.status);
  const loadSeq = useMapStore((state) => state.loadSeq);
  const quality = useUiStore((state) => state.quality);
  const fov = useUiStore((state) => state.fov);
  const sensitivity = useUiStore((state) => state.sensitivity);
  const frameLimit = useUiStore((state) => state.frameLimit);

  // 引擎装载（一次）：产出就绪 promise 供数据加载衔接（StrictMode 双挂载安全）。
  // 抗锯齿是渲染器创建参数，只在装载时读取一次；变更需重建视口（重启页面）。
  useEffect(() => {
    let disposed = false;
    const ready = (async (): Promise<MapViewer | null> => {
      const canvas = canvasRef.current;
      if (canvas === null) {
        return null;
      }
      const { MapViewer } = await import("@/engine");
      if (disposed) {
        return null;
      }
      const created = new MapViewer(canvas, {
        antialias: useUiStore.getState().antialias,
      });
      setViewer(created);
      setProjector(
        () =>
          (world: Vec3): ScreenAnchor | null =>
            created.projectPoi(world),
      );
      return created;
    })();
    viewerReadyRef.current = ready;
    return () => {
      disposed = true;
      setProjector(null);
      setViewer(null);
      viewerReadyRef.current = null;
      void ready.then((created) => {
        created?.dispose();
      });
    };
  }, []);

  // 数据包加载 + 地图图层挂载（按地图；loadSeq 递增驱动同图位失败后的原位重试）。
  useEffect(() => {
    let cancelled = false;
    const attempt = loadSeq + 1; // 本图第 N 次加载尝试（1 起，重试递增）
    useMapStore.getState().setStatus("loading");
    useMapStore.getState().setProgress(0);

    void (async () => {
      const activeViewer = await viewerReadyRef.current;
      if (cancelled) {
        return;
      }
      if (activeViewer === null) {
        throw new Error("渲染视口不可用");
      }

      const bundle: MapBundle = await loadMapBundle(mapId, (fraction) => {
        if (!cancelled) {
          // 索引阶段进度直接驱动加载条（0→1）；分块流式进度就绪后
          // 由流式徽标单独呈现，不回写加载条。
          useMapStore.getState().setProgress(fraction);
        }
      });
      if (cancelled) {
        return;
      }

      // 索引就绪即渲染：楼层以数据包清单为准，POI/2D 派生数据入 store（不等分块）。
      const floors =
        bundle.manifest.floors.length > 0 ? bundle.manifest.floors : bundle.definition.knownFloors;
      useFloorStore.getState().applyFloors(floors, bundle.definition.defaultFloor);
      useMapDataStore.getState().setMapData(mapId, bundle, readMapPoiData(bundle));

      // 引擎复用已打开的分片包，分块容器按需并行拉取（并发池 + 跨流聚合进度）。
      // 流式统计写入 mapStore（仅徽标订阅）：不把引擎回调耦合成本地 state，
      // 避免每次份额推送都重渲染整个视口子树（POI 标注层等）。
      await activeViewer.loadMap(mapId, {
        pkg: bundle.pkg,
        onProgress: (stats) => {
          if (!cancelled) {
            useMapStore.getState().setStreamStats(stats);
          }
        },
      });
      if (cancelled) {
        return;
      }
      useMapStore.getState().setStatus("ready");
    })().catch((error: unknown) => {
      if (cancelled) {
        return;
      }
      // 未预期失败的完整原因进控制台（状态栏只展示归类码）。
      console.error(`地图数据加载失败（第 ${attempt} 次尝试）`, error);
      // 失败即清空视口：避免「状态栏已是新图 + 画布仍渲染旧图场景」的失同步
      // （旧图的分块流也随 unload 一并停止）。
      const failedViewer = viewerReadyRef.current;
      void failedViewer?.then((instance) => {
        instance?.unloadMap();
      });
      useMapDataStore.getState().clear();
      const definition = getMapById(mapId);
      if (definition !== undefined) {
        useFloorStore.getState().applyFloors(definition.knownFloors, definition.defaultFloor);
      }
      useMapStore.getState().setStatus("error", mapLoadErrorCode(error));
    });

    return () => {
      cancelled = true;
    };
  }, [mapId, loadSeq]);

  // 画质：渲染像素比上限。
  useEffect(() => {
    if (viewer === null) {
      return;
    }
    viewer.sceneManager.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, QUALITY_PIXEL_RATIO[quality]),
    );
  }, [viewer, quality]);

  // 帧率上限：运行时调整渲染循环节流。
  useEffect(() => {
    if (viewer === null) {
      return;
    }
    viewer.sceneManager.setFrameLimit(FRAME_LIMIT_FPS[frameLimit]);
  }, [viewer, frameLimit]);

  // 相机设置：FOV/灵敏度即时生效；换图后相机重建，依赖地图就绪状态再次应用。
  useEffect(() => {
    if (viewer === null) {
      return;
    }
    viewer.applyCameraSettings({ fov, sensitivity });
  }, [viewer, fov, sensitivity, mapStatus]);

  // 回出生点：注册到 store，设置面板触发。
  useEffect(() => {
    if (viewer === null) {
      return;
    }
    useUiStore.getState().registerRespawn(() => {
      viewer.respawn();
    });
    return () => {
      useUiStore.getState().registerRespawn(null);
    };
  }, [viewer]);

  // 寻路：订阅 navStore 请求，懒加载导航数据后 A* 求解；
  // 起点取相机注视点（模拟器语义：漫游者即相机），终点为请求目标点。
  useEffect(() => {
    if (viewer === null) {
      return;
    }
    let cancelled = false;
    const unsubscribe = useNavStore.subscribe((state, prev) => {
      if (state.requestSeq === prev.requestSeq || state.requestTarget === null) {
        return;
      }
      const seq = state.requestSeq;
      const target = state.requestTarget;
      void (async () => {
        try {
          const available = await viewer.ensureNavMesh();
          if (cancelled || !available) {
            useNavStore.getState().setUnavailable();
            return;
          }
          const origin = viewer.controls.target;
          const from = { x: origin.x, y: origin.y, z: origin.z };
          const path = viewer.findPath(from, target);
          if (cancelled || useNavStore.getState().requestSeq !== seq) {
            return;
          }
          if (path === null) {
            useNavStore.getState().setUnreachable();
            viewer.setNavPath(null);
            return;
          }
          useNavStore.getState().setReady(path.points, path.distance);
          viewer.setNavPath(path.points);
        } catch (error) {
          console.error("寻路失败", error);
          if (!cancelled) {
            useNavStore.getState().setUnavailable();
          }
        }
      })();
    });
    return () => {
      cancelled = true;
      unsubscribe();
      viewer.clearNavPath();
      useNavStore.getState().clear();
    };
  }, [viewer]);

  // 搜索/气泡“定位”：轨道相机缓动飞行（用户输入可打断）。
  useEffect(() => {
    if (viewer === null) {
      return;
    }
    const unsubscribe = usePoiStore.subscribe((state) => {
      const target = state.flyToTarget;
      if (target === null) {
        return;
      }
      usePoiStore.getState().consumeFlyTo();
      viewer.flyTo(target.position);
    });
    return unsubscribe;
  }, [viewer]);

  // HUD 上报：世界坐标与朝向（节流）。朝向取相机矩阵第三列取反。
  useEffect(() => {
    if (viewer === null) {
      return;
    }
    const camera = viewer.sceneManager.camera;
    const handle = window.setInterval(() => {
      camera.updateMatrixWorld();
      const elements = camera.matrixWorld.elements;
      const dirX = -elements[8];
      const dirZ = -elements[10];
      useUiStore.getState().setCameraHud({
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        yaw: Math.atan2(dirX, -dirZ),
      });
    }, CAMERA_HUD_INTERVAL_MS);
    return () => {
      window.clearInterval(handle);
      useUiStore.getState().setCameraHud(null);
    };
  }, [viewer]);

  // 截图：显式渲染一帧后导出画布为 PNG 下载。
  useEffect(() => {
    if (viewer === null) {
      return;
    }
    const sceneManager = viewer.sceneManager;
    useUiStore.getState().registerScreenshot(() => {
      sceneManager.renderer.render(sceneManager.scene, sceneManager.camera);
      sceneManager.renderer.domElement.toBlob((blob) => {
        if (blob === null) {
          return;
        }
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `df3dmaptool-${Date.now()}.png`;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      }, "image/png");
    });
    return () => {
      useUiStore.getState().registerScreenshot(null);
    };
  }, [viewer]);

  return (
    <div className="map-viewport">
      <canvas ref={canvasRef} className="map-canvas" />
      <PoiOverlay projector={projector} />
      <MinimapHudContainer />
      <NavPathHud />
      <LoadProgressBar />
      <StreamProgressBadge />
    </div>
  );
}

function LoadProgressBar() {
  const status = useMapStore((state) => state.status);
  const progress = useMapStore((state) => state.progress);
  if (status !== "loading") {
    return null;
  }
  return (
    <div
      className="load-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
    >
      <div className="load-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
    </div>
  );
}

/**
 * 场景流式进度徽标（就绪后）：索引就绪即翻「就绪」是既定设计，
 * 分块流的跨流聚合进度（已载实例/总实例）在此持续呈现，
 * 有 pending 或失败冷却中的分块时可见，排空后自动隐藏。
 * 自行订阅 mapStore.streamStats——份额推送只重渲染本徽标，
 * 不波及 POI 标注层等视口子树。
 */
function StreamProgressBadge() {
  const { t } = useTranslation();
  const status = useMapStore((state) => state.status);
  const stats = useMapStore((state) => state.streamStats);
  if (
    status !== "ready" ||
    stats === null ||
    (stats.pendingChunks <= 0 && stats.failedChunks <= 0)
  ) {
    return null;
  }
  const percent = Math.round(stats.fraction * 100);
  const failed = stats.failedChunks > 0;
  return (
    <div className={`stream-progress${failed ? " stream-progress-failed" : ""}`} role="status">
      <span>
        {failed
          ? t("status.streamFailed", { count: stats.failedChunks })
          : t("status.streaming", { percent })}
      </span>
      <div
        className="stream-progress-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="stream-progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

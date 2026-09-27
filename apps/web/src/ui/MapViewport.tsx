import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Vec3 } from "@/common/geometry";
import {
  loadMapBundle,
  loadInteractors,
  mapLoadErrorCode,
  readMapPoiData,
  type InteractorsDoc,
  type MapBundle,
} from "@/data";
import type { MapViewer, ScreenAnchor } from "@/engine";
import { routeRenderModeForPoints } from "@/engine/routeLayer";
import { availableMapModes } from "@/poi/filter";
import { getMapById } from "@/map";
import { MinimapHudContainer } from "@/bigmap";
import { FRAME_LIMIT_FPS, QUALITY_PIXEL_RATIO, useUiStore } from "@/state/uiStore";
import { useFloorStore } from "@/state/floorStore";
import { useMapDataStore } from "@/state/mapDataStore";
import { useMapModeStore } from "@/state/mapModeStore";
import { useMapStore } from "@/state/mapStore";
import { useNavStore } from "@/state/navStore";
import { usePoiStore } from "@/state/poiStore";
import { useViewStore } from "@/state/viewStore";
import { useRouteStore, RECORD_SAMPLE_INTERVAL_MS } from "@/state/routeStore";
import { useInteractStore } from "@/state/interactStore";
import { useCollectionStore } from "@/state/collectionStore";
import { NavPathHud } from "./NavPathHud";
import { PoiOverlay, type PoiProjector } from "./PoiOverlay";
import { isBareHotkey } from "./hotkeys";
import { pickRespawnPosition, RESPAWN_REVEAL_MS, RESPAWN_TELEPORT_DELAY_MS } from "./respawn";

/** HUD 世界坐标/朝向的上报间隔（毫秒）。 */
const CAMERA_HUD_INTERVAL_MS = 200;
/** F 键交互目标探测间隔（毫秒）。 */
const INTERACT_PROBE_INTERVAL_MS = 120;
/** 物资 POI 的 F 键交互半径（米；物件类用数据内半径）。 */
const POI_INTERACT_RADIUS = 5;

/**
 * 3D 视口：挂载 MapViewer（场景 + 轨道相机 + 楼层系统 + chunk 流式地图层），
 * 串联 store 与引擎：数据层负责容器下载/校验（进度与失败归类），
 * 引擎复用已解密容器做清单驱动的流式加载，相机取景/飞入由轨道相机完成。
 * three.js 引擎体量较大，按需动态加载以保证外壳首屏轻量：
 * 本组件不静态引入 three/引擎代码，仅经类型与回调对接。
 *
 * hidden：全页 2D 沙盘视图激活时置位——视口隐藏但保持挂载
 * （相机/分块缓存/标注状态全保留，切回零成本恢复），渲染循环暂停以省开销。
 */
export function MapViewport({ hidden = false }: { hidden?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerReadyRef = useRef<Promise<MapViewer | null> | null>(null);
  const [viewer, setViewer] = useState<MapViewer | null>(null);
  const [projector, setProjector] = useState<PoiProjector>(null);
  const mapId = useMapStore((state) => state.mapId);
  const loadSeq = useMapStore((state) => state.loadSeq);
  const quality = useUiStore((state) => state.quality);
  const fov = useUiStore((state) => state.fov);
  const sensitivity = useUiStore((state) => state.sensitivity);
  const renderDistance = useUiStore((state) => state.renderDistance);
  const frameLimit = useUiStore((state) => state.frameLimit);
  const ambientMotes = useUiStore((state) => state.ambientMotes);

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
      const poiData = readMapPoiData(bundle);
      useMapDataStore.getState().setMapData(mapId, bundle, poiData);
      // 玩法模式可用集随图同步（POI 派生）；当前模式失效时由 store 回落首档。
      useMapModeStore.getState().applyAvailableModes(availableMapModes(poiData.pois));

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
      // 换图后相机重建：把当前相机设置（FOV/灵敏度/渲染距离）再次应用到新控件。
      const settings = useUiStore.getState();
      activeViewer.applyCameraSettings({
        fov: settings.fov,
        sensitivity: settings.sensitivity,
        renderDistance: settings.renderDistance,
      });
      useMapStore.getState().setStatus("ready");

      // 路线/交互物件数据（同容器 routes.dmap；未分发按空态处理）+ 共享收藏数据预取。
      void useRouteStore.getState().loadForMap(bundle.definition.code);
      void loadInteractors(bundle.definition.code)
        .then((doc: InteractorsDoc) => {
          if (!cancelled) {
            activeViewer.setInteractors(doc);
          }
        })
        .catch(() => {
          if (!cancelled) {
            activeViewer.setInteractors(null);
          }
        });
      void useCollectionStore.getState().ensureData();
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
      useMapModeStore.getState().reset();
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

  // 环境漂浮粒子（「环境漂浮粒子」设置项的真实效果）：开关即时增删粒子层；
  // 层跨地图常驻（不随换图重建），粒子环绕相机注视点漂浮。
  useEffect(() => {
    if (viewer === null) {
      return;
    }
    viewer.setAmbientMotes(ambientMotes);
  }, [viewer, ambientMotes]);

  // 2D 沙盘视图激活时暂停渲染循环（场景保持挂载），切回即恢复；
  // 飞行动画按帧间隔推进，暂停期间冻结、恢复后从原进度续播。
  useEffect(() => {
    if (viewer === null) {
      return;
    }
    if (hidden) {
      viewer.sceneManager.stop();
    } else {
      viewer.sceneManager.start();
    }
  }, [viewer, hidden]);

  // 相机设置：FOV/灵敏度/渲染距离即时生效；换图后相机重建，
  // 由加载流程完成时再次应用（loadMap 效果内），不依赖状态字段触发。
  useEffect(() => {
    if (viewer === null) {
      return;
    }
    viewer.applyCameraSettings({ fov, sensitivity, renderDistance });
  }, [viewer, fov, sensitivity, renderDistance]);

  // 回出生点：注册到 store（R 键与设置面板按钮同一执行器）。
  // 流程：进图加载遮罩上屏 → 短延迟后遮罩下硬传送相机到出生点集随机落点
  // （无出生点数据时回落地图默认出生点/进场取景位）→ 遮罩期间流式拉取
  // 新取景区域分块 → 定时硬切卸载遮罩（弱环境主线程饱和时定时器顺延，
  // 实际解除落在流式收口之后）。传送前短延迟：先让遮罩渲染上屏再触发
  // 新区域的流式重活，避免遮罩挂起被饿死（按键后见到的是加载屏而非冻结旧帧）。
  useEffect(() => {
    if (viewer === null) {
      return;
    }
    useUiStore.getState().registerRespawn(() => {
      const ui = useUiStore.getState();
      if (ui.respawnCoverOpen) {
        return;
      }
      const poiData = useMapDataStore.getState().poiData;
      const position =
        poiData === null
          ? null
          : pickRespawnPosition(poiData.pois, poiData.categories, poiData.defaultBornPos);
      ui.setRespawnCoverOpen(true);
      window.setTimeout(() => {
        viewer.respawn(position);
      }, RESPAWN_TELEPORT_DELAY_MS);
      window.setTimeout(() => {
        useUiStore.getState().setRespawnCoverOpen(false);
      }, RESPAWN_REVEAL_MS);
    });
    return () => {
      useUiStore.getState().registerRespawn(null);
    };
  }, [viewer]);

  // R 键回出生点：3D 视图即时触发（HUD 常驻键位；与设置面板按钮同一执行器，
  // 视口未就绪时 requestRespawn 静默忽略）。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isBareHotkey(event, "r")) {
        return;
      }
      if (hidden || useViewStore.getState().view !== "3d") {
        return;
      }
      event.preventDefault();
      useUiStore.getState().requestRespawn();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [hidden]);

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

  // 路线系统：详情选中路线 → 3D 主线呈现；跟跑请求 → 相机沿点位按原始节奏回放。
  // 跟跑启动时按路线数据选择全程/分段渲染（分段模式只画前方窗口，随进度推进），
  // 跟跑结束（自然完成/打断/结束导航）后恢复详情主线的全程呈现。
  useEffect(() => {
    if (viewer === null) {
      return;
    }
    const routePoints = (route: {
      readonly pointCount: number;
      readonly points: Float32Array;
    }): Vec3[] => {
      const points: Vec3[] = [];
      for (let i = 0; i < route.pointCount; i += 1) {
        const base = i * 3;
        points.push({
          x: route.points[base] ?? 0,
          y: route.points[base + 1] ?? 0,
          z: route.points[base + 2] ?? 0,
        });
      }
      return points;
    };
    const renderDetail = (route: ReturnType<typeof useRouteStore.getState>["detailRoute"]) => {
      if (route === null) {
        viewer.setRouteDisplay(null);
        return;
      }
      viewer.setRouteDisplay(
        routePoints(route),
        route.markers.map((marker) => marker.worldPos),
      );
    };
    renderDetail(useRouteStore.getState().detailRoute);
    const unsubscribeDetail = useRouteStore.subscribe((state, prev) => {
      if (state.detailRoute !== prev.detailRoute) {
        renderDetail(state.detailRoute);
      }
    });

    const unsubscribeFollow = useRouteStore.subscribe((state, prev) => {
      if (state.followRequestSeq === prev.followRequestSeq) {
        return;
      }
      if (state.followRouteId === null) {
        viewer.stopRoutePlayback();
        viewer.setRouteSegmentIndex(null);
        renderDetail(useRouteStore.getState().detailRoute);
        return;
      }
      const route =
        [...state.custom, ...state.builtin].find((entry) => entry.id === state.followRouteId) ??
        null;
      if (route === null) {
        useRouteStore.getState().finishFollow(state.followRouteId);
        return;
      }
      const routeId = route.id;
      // 导航启动：路线主线 + 标注路牌随跟跑呈现，渲染模式按点位规模决定。
      viewer.setRouteDisplay(
        routePoints(route),
        route.markers.map((marker) => marker.worldPos),
        routeRenderModeForPoints(route.pointCount),
      );
      const playback = viewer.startRoutePlayback(
        route.points,
        route.durationSeconds,
        (fraction, pointIndex) => {
          useRouteStore.getState().reportFollowProgress(routeId, fraction, pointIndex);
          viewer.setRouteSegmentIndex(pointIndex);
        },
      );
      if (playback !== null) {
        void playback.then((completed) => {
          useRouteStore.getState().finishFollow(routeId);
          viewer.setRouteSegmentIndex(null);
          renderDetail(useRouteStore.getState().detailRoute);
          void completed;
        });
      }
    });

    return () => {
      unsubscribeDetail();
      unsubscribeFollow();
      viewer.stopRoutePlayback();
      viewer.setRouteDisplay(null);
      useRouteStore.getState().stopFollow();
    };
  }, [viewer]);

  // 自录采样：录制会话激活期间按固定间隔记录相机注视点（管线世界系）。
  useEffect(() => {
    if (viewer === null) {
      return;
    }
    const handle = window.setInterval(() => {
      const record = useRouteStore.getState().record;
      if (record === null) {
        return;
      }
      const target = viewer.controls.target;
      useRouteStore.getState().pushRecordSample({
        x: target.x,
        y: target.y,
        z: target.z,
      });
    }, RECORD_SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [viewer]);

  // F 键交互：节流探测近旁目标（物件/物资 POI）驱动提示与高亮；
  // F 键动作 = 物件交互（梯子/绳索传送、滑索滑行）或打开物资面板。
  useEffect(() => {
    if (viewer === null) {
      return;
    }
    const probe = () => {
      if (hidden || useViewStore.getState().view !== "3d") {
        return;
      }
      const interactor = viewer.nearestInteractor();
      let poiCandidate: { id: string; name: string; distance: number } | null = null;
      const collectionState = useCollectionStore.getState();
      const poiData = useMapDataStore.getState().poiData;
      if (collectionState.data !== null && poiData !== null) {
        const target = viewer.controls.target;
        for (const poi of poiData.pois) {
          if (!collectionState.data.poiRollId.has(poi.id)) {
            continue;
          }
          const dx = poi.position.x - target.x;
          const dy = poi.position.y - target.y;
          const dz = poi.position.z - target.z;
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (
            distance <= POI_INTERACT_RADIUS &&
            (poiCandidate === null || distance < poiCandidate.distance)
          ) {
            poiCandidate = { id: poi.id, name: poi.displayName, distance };
          }
        }
      }
      if (
        interactor !== null &&
        interactor.distance <= interactor.radius &&
        (poiCandidate === null || interactor.distance <= poiCandidate.distance)
      ) {
        viewer.setInteractorHighlight(interactor);
        useInteractStore.getState().setNearby({
          kind: interactor.kind,
          interactor,
          distance: interactor.distance,
        });
      } else if (poiCandidate !== null) {
        viewer.setInteractorHighlight(null);
        useInteractStore.getState().setNearby({
          kind: "poi",
          poiId: poiCandidate.id,
          poiName: poiCandidate.name,
          distance: poiCandidate.distance,
        });
      } else {
        viewer.setInteractorHighlight(null);
        useInteractStore.getState().setNearby(null);
      }
    };
    const probeHandle = window.setInterval(probe, INTERACT_PROBE_INTERVAL_MS);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "f" || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      const nearby = useInteractStore.getState().nearby;
      if (nearby === null) {
        return;
      }
      event.preventDefault();
      if (nearby.interactor !== undefined) {
        viewer.interact(nearby.interactor);
        return;
      }
      if (nearby.poiId !== undefined) {
        const collectionState = useCollectionStore.getState();
        if (collectionState.data === null) {
          return;
        }
        const rollId = collectionState.data.poiRollId.get(nearby.poiId);
        if (rollId !== undefined) {
          collectionState.openPanel(nearby.poiId, rollId, collectionState.data);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearInterval(probeHandle);
      window.removeEventListener("keydown", handleKeyDown);
      useInteractStore.getState().setNearby(null);
    };
  }, [viewer, hidden]);

  return (
    <div className={hidden ? "map-viewport hidden" : "map-viewport"}>
      <canvas ref={canvasRef} className="map-canvas" />
      <PoiOverlay projector={projector} />
      <MinimapHudContainer />
      <NavPathHud />
      {/* 索引/首屏批次的加载呈现由 ui/loading 的加载页负责（boot 屏 + 进图屏），
          本视口只保留就绪后的流式进度徽标。 */}
      <StreamProgressBadge />
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

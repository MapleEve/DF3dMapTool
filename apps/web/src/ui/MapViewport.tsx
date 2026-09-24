import { useEffect, useRef, useState } from 'react';
import type { Vec3 } from '@/common/geometry';
import { loadMapBundle, mapLoadErrorCode, readMapPoiData, type MapBundle } from '@/data';
import type { MapViewer, ScreenAnchor } from '@/engine';
import { QUALITY_PIXEL_RATIO, useUiStore } from '@/state/uiStore';
import { useFloorStore } from '@/state/floorStore';
import { useMapDataStore } from '@/state/mapDataStore';
import { useMapStore } from '@/state/mapStore';
import { usePoiStore } from '@/state/poiStore';
import { PoiOverlay, type PoiProjector } from './PoiOverlay';

/**
 * 容器下载/解密在总进度中的权重（0..1），其余进度由 chunk 流式加载推进。
 * 下载是首屏的主要等待，chunk 增量在就绪后仍会持续。
 */
const FETCH_PROGRESS_WEIGHT = 0.7;
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
  const quality = useUiStore((state) => state.quality);

  // 引擎装载（一次）：产出就绪 promise 供数据加载衔接（StrictMode 双挂载安全）。
  useEffect(() => {
    let disposed = false;
    const ready = (async (): Promise<MapViewer | null> => {
      const canvas = canvasRef.current;
      if (canvas === null) {
        return null;
      }
      const { MapViewer } = await import('@/engine');
      if (disposed) {
        return null;
      }
      const created = new MapViewer(canvas);
      setViewer(created);
      setProjector(() => (world: Vec3): ScreenAnchor | null => created.projectPoi(world));
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

  // 数据包加载 + 地图图层挂载（按地图）。
  useEffect(() => {
    let cancelled = false;
    useMapStore.getState().setStatus('loading');
    useMapStore.getState().setProgress(0);

    void (async () => {
      const activeViewer = await viewerReadyRef.current;
      if (cancelled) {
        return;
      }
      if (activeViewer === null) {
        throw new Error('渲染视口不可用');
      }

      const bundle: MapBundle = await loadMapBundle(mapId, (fraction) => {
        if (!cancelled) {
          useMapStore.getState().setProgress(fraction * FETCH_PROGRESS_WEIGHT);
        }
      });
      if (cancelled) {
        return;
      }

      // 楼层以数据包清单为准，回退注册表标定值；POI/2D 派生数据入 store。
      const floors =
        bundle.manifest.floors.length > 0
          ? bundle.manifest.floors
          : bundle.definition.knownFloors;
      useFloorStore.getState().applyFloors(floors, bundle.definition.defaultFloor);
      useMapDataStore.getState().setMapData(mapId, bundle, readMapPoiData(bundle));

      // 引擎复用已解密容器，chunk 流式加载推进剩余进度。
      await activeViewer.loadMap(mapId, {
        loader: bundle.loader,
        baseUrl: bundle.definition.bundleUrl,
        onProgress: (stats) => {
          if (cancelled) {
            return;
          }
          const fraction = Math.min(1, stats.loadedChunks / Math.max(stats.totalChunks, 1));
          useMapStore
            .getState()
            .setProgress(FETCH_PROGRESS_WEIGHT + (1 - FETCH_PROGRESS_WEIGHT) * fraction);
        },
      });
      if (cancelled) {
        return;
      }
      useMapStore.getState().setProgress(1);
      useMapStore.getState().setStatus('ready');
    })().catch((error: unknown) => {
      if (cancelled) {
        return;
      }
      // 未预期失败的完整原因进控制台（状态栏只展示归类码）。
      console.error('地图数据加载失败', error);
      useMapDataStore.getState().clear();
      useMapStore.getState().setStatus('error', mapLoadErrorCode(error));
    });

    return () => {
      cancelled = true;
    };
  }, [mapId]);

  // 画质：渲染像素比上限。
  useEffect(() => {
    if (viewer === null) {
      return;
    }
    viewer.sceneManager.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, QUALITY_PIXEL_RATIO[quality]),
    );
  }, [viewer, quality]);

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
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `df3dmaptool-${Date.now()}.png`;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      }, 'image/png');
    });
    return () => {
      useUiStore.getState().registerScreenshot(null);
    };
  }, [viewer]);

  return (
    <div className="map-viewport">
      <canvas ref={canvasRef} className="map-canvas" />
      <PoiOverlay projector={projector} />
      <LoadProgressBar />
    </div>
  );
}

function LoadProgressBar() {
  const status = useMapStore((state) => state.status);
  const progress = useMapStore((state) => state.progress);
  if (status !== 'loading') {
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

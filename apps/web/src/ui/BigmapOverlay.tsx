import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  floorCalibration,
  floorImageInfo,
  getIconObjectUrl,
  resolveFloorEntry,
  type RawMap2dFloor,
} from "@/data";
import { MAX_ZOOM_INDEX, MIN_ZOOM_INDEX, planTeleport, resolveTeleportFloor } from "@/bigmap";
import { BigmapCanvas, type BigmapController, type BigmapPoiMarker } from "@/bigmap/BigmapCanvas";
import type { WorldXZ } from "@/bigmap/types";
import { filterPois } from "@/poi/filter";
import { useFloorStore } from "@/state/floorStore";
import { useMapDataStore } from "@/state/mapDataStore";
import { useMapStore } from "@/state/mapStore";
import { usePoiFilterStore } from "@/state/poiFilterStore";
import { usePoiStore } from "@/state/poiStore";
import { useUiStore } from "@/state/uiStore";

/**
 * 2D 俯视大地图覆盖层（M 键全屏）。
 * 底图为数据包内按楼层烘焙的俯视整图；与 3D 共用同一份 POI 数据与投影标定。
 * 3D 场景常驻：本覆盖层只在其上显示，开合不触碰 3D 相机状态（2D/3D 切换位置记忆）；
 * 传送（标记/POI）为显式按钮动作：像素→世界逆变换 → 3D 相机飞行 + 跨层楼层同步。
 */
export function BigmapOverlay() {
  const { t } = useTranslation();
  const setBigmapOpen = useUiStore((state) => state.setBigmapOpen);
  const cameraHud = useUiStore((state) => state.cameraHud);
  const status = useMapStore((state) => state.status);
  const bundle = useMapDataStore((state) => state.bundle);
  const poiData = useMapDataStore((state) => state.poiData);
  const floors = useFloorStore((state) => state.floors);
  const floor = useFloorStore((state) => state.floor);
  const setFloor = useFloorStore((state) => state.setFloor);
  const hiddenCategories = usePoiFilterStore((state) => state.hiddenCategories);
  const selectedPoiId = usePoiStore((state) => state.selectedPoiId);
  const selectPoi = usePoiStore((state) => state.selectPoi);
  const requestFlyTo = usePoiStore((state) => state.requestFlyTo);

  // 大地图楼层独立于 3D 楼层：null 表示“全图”概览，进入时跟随当前楼层。
  const [bigmapFloor, setBigmapFloor] = useState<number | null>(null);
  const [marker, setMarker] = useState<WorldXZ | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [zoomStep, setZoomStep] = useState<number>(MIN_ZOOM_INDEX);
  const [iconVersion, setIconVersion] = useState(0);
  const iconImagesRef = useRef(new Map<string, HTMLImageElement>());
  const controllerRef = useRef<BigmapController | null>(null);
  const pkg = bundle?.pkg ?? null;

  useEffect(() => {
    setBigmapFloor(null);
    setMarker(null);
    setSelectedRegionId(null);
    setZoomStep(MIN_ZOOM_INDEX);
  }, [poiData]);

  // 楼层条目 + 标定 + 底图 object URL。
  const floorEntry: RawMap2dFloor | null = useMemo(() => {
    if (poiData === null) {
      return null;
    }
    return resolveFloorEntry(poiData.map2d, bigmapFloor);
  }, [poiData, bigmapFloor]);

  const imageUrl = useMemo(() => {
    if (pkg === null || floorEntry === null || !pkg.has(floorEntry.image)) {
      return null;
    }
    return getIconObjectUrl(pkg, floorEntry.image) ?? null;
  }, [pkg, floorEntry]);

  const imageSize = useMemo(() => {
    if (floorEntry === null) {
      return null;
    }
    const info = floorImageInfo(floorEntry);
    return { width: info.width, height: info.height };
  }, [floorEntry]);

  const calibration = useMemo(() => {
    return floorEntry !== null ? floorCalibration(floorEntry) : null;
  }, [floorEntry]);

  // 2D POI：同源数据 + 分类/楼层筛选（全图概览不过滤楼层）+ hideInBigmap。
  const markers: readonly BigmapPoiMarker[] = useMemo(() => {
    void iconVersion; // 图标位图加载完成后重建标记以触发重绘。
    if (poiData === null) {
      return [];
    }
    const visible = filterPois(poiData.pois, {
      hiddenCategories,
      floor: bigmapFloor,
    }).filter((poi) => poi.hiddenInBigmap !== true);
    return visible.map((poi) => ({
      id: poi.id,
      world: { x: poi.position.x, z: poi.position.z },
      color:
        poiData.categories.find((category) => category.id === poi.categoryId)?.color ?? "#8fa3b8",
      icon: poi.iconFile !== undefined ? (iconImagesRef.current.get(poi.iconFile) ?? null) : null,
      selected: poi.id === selectedPoiId,
    }));
  }, [poiData, hiddenCategories, bigmapFloor, selectedPoiId, iconVersion]);

  // 预加载可见 POI 的图标位图。
  useEffect(() => {
    if (pkg === null || poiData === null) {
      return;
    }
    let cancelled = false;
    const files = new Set<string>();
    for (const poi of poiData.pois) {
      if (poi.iconFile !== undefined && !iconImagesRef.current.has(poi.iconFile)) {
        files.add(poi.iconFile);
      }
    }
    for (const file of files) {
      const url = getIconObjectUrl(pkg, file);
      if (url === undefined) {
        continue;
      }
      const image = new Image();
      image.src = url;
      image
        .decode()
        .then(() => {
          if (cancelled) {
            return;
          }
          iconImagesRef.current.set(file, image);
          setIconVersion((version) => version + 1);
        })
        .catch(() => {
          // 图标解码失败时走色点占位。
        });
    }
    return () => {
      cancelled = true;
    };
  }, [pkg, poiData, markers]);

  const regions = useMemo(() => {
    if (poiData === null) {
      return [];
    }
    return poiData.regions.map((region) => ({
      id: region.id,
      world: { x: region.position.x, z: region.position.z },
      name: region.name,
    }));
  }, [poiData]);

  const selectedRegion = useMemo(() => {
    if (poiData === null || selectedRegionId === null) {
      return null;
    }
    return poiData.regions.find((region) => region.id === selectedRegionId) ?? null;
  }, [poiData, selectedRegionId]);

  const selectedPoi = useMemo(() => {
    if (poiData === null || selectedPoiId === null) {
      return null;
    }
    return poiData.pois.find((poi) => poi.id === selectedPoiId) ?? null;
  }, [poiData, selectedPoiId]);

  const playerXZ = useMemo(
    () => (cameraHud === null ? null : { x: cameraHud.position.x, z: cameraHud.position.z }),
    [cameraHud],
  );

  // 传送执行：楼层同步 → 3D 相机飞行 → 返回 3D（大地图关闭，相机记忆新落点）。
  const teleportToWorld = (
    world: WorldXZ,
    worldY: number | undefined,
    targetFloor: number | null,
  ) => {
    const plan = planTeleport({ world, worldY, targetFloor, currentFloor: floor, floors });
    if (plan.floorChanged) {
      setFloor(plan.floor);
    }
    requestFlyTo(plan.position);
    setBigmapOpen(false);
  };

  const handleTeleportMarker = () => {
    if (marker === null) {
      return;
    }
    teleportToWorld(marker, undefined, bigmapFloor);
    setMarker(null);
  };

  const handleTeleportPoi = () => {
    if (selectedPoi === null) {
      return;
    }
    teleportToWorld(
      { x: selectedPoi.position.x, z: selectedPoi.position.z },
      selectedPoi.position.y,
      resolveTeleportFloor(selectedPoi.floor, bigmapFloor),
    );
  };

  const handleSelectRegion = (regionId: string | null) => {
    setSelectedRegionId(regionId);
    if (regionId === null || poiData === null) {
      return;
    }
    const region = poiData.regions.find((entry) => entry.id === regionId);
    if (region !== undefined) {
      // 区域定位：高亮当前层标注 + 3D 相机飞向区域锚点（大地图保持打开）。
      requestFlyTo(region.position);
    }
  };

  const floorOptions = useMemo<
    readonly { readonly value: number | null; readonly key: string; readonly label: string }[]
  >(() => {
    const overview: readonly {
      value: number | null;
      key: string;
      label: string;
    }[] = [{ value: null, key: "overview", label: t("bigmap.overviewFloor") }];
    const floorItems: readonly {
      value: number | null;
      key: string;
      label: string;
    }[] = floors.map((value) => ({
      value,
      key: `floor-${value}`,
      label:
        value < 0
          ? t("floor.basement", { floor: Math.abs(value) })
          : t("floor.floorName", { floor: value }),
    }));
    return [...overview, ...floorItems];
  }, [t, floors]);

  return (
    <div className="bigmap-overlay" role="dialog" aria-label={t("bigmap.title")}>
      <header className="bigmap-header">
        <h2>{t("bigmap.title")}</h2>
        <div className="bigmap-floor-list" role="tablist" aria-label={t("bigmap.floorTitle")}>
          {floorOptions.map((option) => {
            const active = bigmapFloor === option.value;
            return (
              <button
                key={option.key}
                type="button"
                role="tab"
                aria-selected={active}
                className={active ? "bigmap-floor active" : "bigmap-floor"}
                onClick={() => {
                  setBigmapFloor(option.value);
                  if (option.value !== null) {
                    setFloor(option.value);
                  }
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <div className="bigmap-zoom-controls">
          <button
            type="button"
            onClick={() => controllerRef.current?.zoomIn()}
            aria-label={t("bigmap.zoomIn")}
          >
            +
          </button>
          <button
            type="button"
            onClick={() => controllerRef.current?.zoomOut()}
            aria-label={t("bigmap.zoomOut")}
          >
            −
          </button>
          <input
            type="range"
            className="bigmap-zoom-slider"
            min={MIN_ZOOM_INDEX}
            max={MAX_ZOOM_INDEX}
            step={1}
            value={zoomStep}
            aria-label={t("bigmap.zoomSlider")}
            onChange={(event) => {
              const next = Number(event.target.value);
              setZoomStep(next);
              controllerRef.current?.setZoomStep(next);
            }}
          />
          <button type="button" onClick={() => controllerRef.current?.resetView()}>
            {t("bigmap.resetView")}
          </button>
        </div>
        <div className="bigmap-teleport-actions">
          <button
            type="button"
            disabled={selectedPoi === null}
            onClick={handleTeleportPoi}
            title={selectedPoi?.displayName}
          >
            {t("bigmap.teleportToPoi")}
          </button>
          <button type="button" disabled={marker === null} onClick={handleTeleportMarker}>
            {t("bigmap.teleportToMarker")}
          </button>
        </div>
        <span className="bigmap-hint">{t("bigmap.hint")}</span>
        <button type="button" className="topbar-button" onClick={() => setBigmapOpen(false)}>
          {t("toolbar.closeBigmap")}
        </button>
      </header>
      <div className="bigmap-canvas-host">
        {status === "ready" && poiData !== null ? (
          <BigmapCanvas
            imageUrl={imageUrl}
            imageSize={imageSize}
            calibration={calibration}
            pois={markers}
            regions={regions}
            selectedRegionId={selectedRegionId}
            playerXZ={playerXZ}
            playerYaw={cameraHud?.yaw ?? null}
            marker={marker}
            onSelectPoi={selectPoi}
            onPlaceMarker={setMarker}
            onSelectRegion={handleSelectRegion}
            onZoomChange={setZoomStep}
            controllerRef={controllerRef}
          />
        ) : (
          <p className="bigmap-placeholder">
            {status === "ready" ? t("bigmap.needCalibration") : t("sidebar.needMapData")}
          </p>
        )}
      </div>
      {selectedRegion !== null ? (
        <footer className="bigmap-region-bar" role="status">
          {t("bigmap.selectedRegion", { name: selectedRegion.name })}
        </footer>
      ) : null}
    </div>
  );
}

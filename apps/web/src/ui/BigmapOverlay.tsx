import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  floorCalibration,
  floorImageInfo,
  getIconObjectUrl,
  resolveFloorEntry,
  type RawMap2dFloor,
} from '@/data';
import { BigmapCanvas, type BigmapController, type BigmapPoiMarker } from '@/bigmap/BigmapCanvas';
import type { WorldXZ } from '@/bigmap/types';
import { filterPois } from '@/poi/filter';
import { useFloorStore } from '@/state/floorStore';
import { useMapDataStore } from '@/state/mapDataStore';
import { useMapStore } from '@/state/mapStore';
import { usePoiFilterStore } from '@/state/poiFilterStore';
import { usePoiStore } from '@/state/poiStore';
import { useUiStore } from '@/state/uiStore';

/**
 * 2D 俯视大地图覆盖层（M 键全屏）。
 * 底图为数据包内按楼层烘焙的俯视整图；与 3D 共用同一份 POI 数据与投影标定。
 */
export function BigmapOverlay() {
  const { t } = useTranslation();
  const setBigmapOpen = useUiStore((state) => state.setBigmapOpen);
  const cameraHud = useUiStore((state) => state.cameraHud);
  const status = useMapStore((state) => state.status);
  const bundle = useMapDataStore((state) => state.bundle);
  const poiData = useMapDataStore((state) => state.poiData);
  const floors = useFloorStore((state) => state.floors);
  const setFloor = useFloorStore((state) => state.setFloor);
  const hiddenCategories = usePoiFilterStore((state) => state.hiddenCategories);
  const selectedPoiId = usePoiStore((state) => state.selectedPoiId);
  const selectPoi = usePoiStore((state) => state.selectPoi);

  // 大地图楼层独立于 3D 楼层：null 表示“全图”概览，进入时跟随当前楼层。
  const [bigmapFloor, setBigmapFloor] = useState<number | null>(null);
  const [marker, setMarker] = useState<WorldXZ | null>(null);
  const [iconVersion, setIconVersion] = useState(0);
  const iconImagesRef = useRef(new Map<string, HTMLImageElement>());
  const controllerRef = useRef<BigmapController | null>(null);
  const loader = bundle?.loader ?? null;

  useEffect(() => {
    setBigmapFloor(null);
    setMarker(null);
  }, [poiData]);

  // 楼层条目 + 标定 + 底图 object URL。
  const floorEntry: RawMap2dFloor | null = useMemo(() => {
    if (poiData === null) {
      return null;
    }
    return resolveFloorEntry(poiData.map2d, bigmapFloor);
  }, [poiData, bigmapFloor]);

  const imageUrl = useMemo(() => {
    if (loader === null || floorEntry === null || !loader.has(floorEntry.image)) {
      return null;
    }
    return getIconObjectUrl(loader, floorEntry.image) ?? null;
  }, [loader, floorEntry]);

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
      color: poiData.categories.find((category) => category.id === poi.categoryId)?.color ?? '#8fa3b8',
      icon: poi.iconFile !== undefined ? iconImagesRef.current.get(poi.iconFile) ?? null : null,
      selected: poi.id === selectedPoiId,
    }));
  }, [poiData, hiddenCategories, bigmapFloor, selectedPoiId, iconVersion]);

  // 预加载可见 POI 的图标位图。
  useEffect(() => {
    if (loader === null || poiData === null) {
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
      const url = getIconObjectUrl(loader, file);
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
  }, [loader, poiData, markers]);

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

  const playerXZ = useMemo(
    () => (cameraHud === null ? null : { x: cameraHud.position.x, z: cameraHud.position.z }),
    [cameraHud],
  );

  const floorOptions = useMemo<
    readonly { readonly value: number | null; readonly key: string; readonly label: string }[]
  >(() => {
    const overview: readonly {
      value: number | null;
      key: string;
      label: string;
    }[] = [{ value: null, key: 'overview', label: t('bigmap.overviewFloor') }];
    const floorItems: readonly {
      value: number | null;
      key: string;
      label: string;
    }[] = floors.map((value) => ({
      value,
      key: `floor-${value}`,
      label:
        value < 0
          ? t('floor.basement', { floor: Math.abs(value) })
          : t('floor.floorName', { floor: value }),
    }));
    return [...overview, ...floorItems];
  }, [t, floors]);

  return (
    <div className="bigmap-overlay" role="dialog" aria-label={t('bigmap.title')}>
      <header className="bigmap-header">
        <h2>{t('bigmap.title')}</h2>
        <div className="bigmap-floor-list" role="tablist" aria-label={t('bigmap.floorTitle')}>
          {floorOptions.map((option) => {
            const active = bigmapFloor === option.value;
            return (
              <button
                key={option.key}
                type="button"
                role="tab"
                aria-selected={active}
                className={active ? 'bigmap-floor active' : 'bigmap-floor'}
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
          <button type="button" onClick={() => controllerRef.current?.zoomIn()} aria-label={t('bigmap.zoomIn')}>
            +
          </button>
          <button type="button" onClick={() => controllerRef.current?.zoomOut()} aria-label={t('bigmap.zoomOut')}>
            −
          </button>
          <button type="button" onClick={() => controllerRef.current?.resetView()}>
            {t('bigmap.resetView')}
          </button>
        </div>
        <span className="bigmap-hint">{t('bigmap.hint')}</span>
        <button type="button" className="topbar-button" onClick={() => setBigmapOpen(false)}>
          {t('toolbar.closeBigmap')}
        </button>
      </header>
      <div className="bigmap-canvas-host">
        {status === 'ready' && poiData !== null ? (
          <BigmapCanvas
            imageUrl={imageUrl}
            imageSize={imageSize}
            calibration={calibration}
            pois={markers}
            regions={regions}
            playerXZ={playerXZ}
            playerYaw={cameraHud?.yaw ?? null}
            marker={marker}
            onSelectPoi={selectPoi}
            onPlaceMarker={setMarker}
            controllerRef={controllerRef}
          />
        ) : (
          <p className="bigmap-placeholder">
            {status === 'ready' ? t('bigmap.needCalibration') : t('sidebar.needMapData')}
          </p>
        )}
      </div>
    </div>
  );
}

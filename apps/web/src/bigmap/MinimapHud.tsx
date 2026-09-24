import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getIconObjectUrl, resolveFloorEntry, type RawMap2dFloor } from "@/data";
import { filterPois } from "@/poi/filter";
import { useFloorStore } from "@/state/floorStore";
import { useMapDataStore } from "@/state/mapDataStore";
import { useMapStore } from "@/state/mapStore";
import { usePoiFilterStore } from "@/state/poiFilterStore";
import { usePoiStore } from "@/state/poiStore";
import { useUiStore } from "@/state/uiStore";
import {
  minimapWorldSpan,
  minimapWindowUv,
  pipelineWorldDisplayCoords,
  worldToMinimapCanvas,
} from "./minimap";
import type { BigmapCalibration, WorldXZ } from "./types";
import type { BigmapPoiMarker, BigmapRegionLabel } from "./BigmapCanvas";

export interface MinimapHudProps {
  /** 当前楼层的俯视底图 object URL（与 2D 大地图同一数据源）。 */
  imageUrl: string | null;
  imageSize: { readonly width: number; readonly height: number } | null;
  calibration: BigmapCalibration | null;
  pois: readonly BigmapPoiMarker[];
  regions: readonly BigmapRegionLabel[];
  playerXZ: WorldXZ | null;
  /** 视角朝向（弧度）：0 = 画面上方（世界 -Z），正值顺时针（东）。 */
  playerYaw: number | null;
  /** 画布边长（CSS 像素，正方形视窗）。 */
  sizePx: number;
}

/**
 * 小地图画布（对齐 WGMiniMap：m_HudRawIamge 取景裁剪 + m_RegionLayerRoot 区域名层
 * + m_PlayerIcon 朝向箭头 + m_TxtWorldPosInfo 坐标文本）。
 * 与 2D 大地图共用楼层俯视贴图、标定与 POI 数据，仅渲染形态不同：
 * 按相机世界坐标取景裁剪、紧凑圆点标记。
 */
export function MinimapHud(props: MinimapHudProps) {
  const { imageUrl, imageSize, calibration, pois, regions, playerXZ, playerYaw, sizePx } = props;
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageVersion, setImageVersion] = useState(0);

  // 底图加载（与 BigmapCanvas 同构：换图/换层后重建位图）。
  useEffect(() => {
    if (imageUrl === null) {
      imageRef.current = null;
      setImageVersion((version) => version + 1);
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.src = imageUrl;
    image
      .decode()
      .then(() => {
        if (cancelled) {
          return;
        }
        imageRef.current = image;
        setImageVersion((version) => version + 1);
      })
      .catch(() => {
        if (!cancelled) {
          imageRef.current = null;
          setImageVersion((version) => version + 1);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  // 每次渲染后重绘：相机 HUD 200ms 节流 + 楼层/筛选/贴图变化都会触发渲染。
  useEffect(() => {
    void imageVersion; // 位图就绪也是一次重绘触发。
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const pixelSize = Math.round(sizePx * dpr);
    if (canvas.width !== pixelSize || canvas.height !== pixelSize) {
      canvas.width = pixelSize;
      canvas.height = pixelSize;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#080c11";
    ctx.fillRect(0, 0, sizePx, sizePx);
    const image = imageRef.current;
    if (image === null || imageSize === null || calibration === null) {
      return;
    }

    // 视窗：无相机位置时退化为整图概览。
    const span = minimapWorldSpan(calibration);
    const view =
      playerXZ !== null
        ? minimapWindowUv(playerXZ, calibration, span)
        : { u0: 0, v0: 0, u1: 1, v1: 1 };
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      image,
      view.u0 * imageSize.width,
      view.v0 * imageSize.height,
      (view.u1 - view.u0) * imageSize.width,
      (view.v1 - view.v0) * imageSize.height,
      0,
      0,
      sizePx,
      sizePx,
    );

    const toCanvas = (world: WorldXZ) => worldToMinimapCanvas(world, calibration, view, sizePx);

    // 区域名层（m_RegionLayerRoot）。
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = '600 10px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    for (const region of regions) {
      const point = toCanvas(region.world);
      if (point.x < -30 || point.x > sizePx + 30 || point.y < -10 || point.y > sizePx + 10) {
        continue;
      }
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "rgba(5, 8, 12, 0.85)";
      ctx.strokeText(region.name, point.x, point.y);
      ctx.fillStyle = "rgba(219, 231, 243, 0.9)";
      ctx.fillText(region.name, point.x, point.y);
    }

    // POI 紧凑圆点层（与大地图同源筛选，刷红/刷卡点同源呈现）。
    for (const poi of pois) {
      const point = toCanvas(poi.world);
      if (point.x < -4 || point.x > sizePx + 4 || point.y < -4 || point.y > sizePx + 4) {
        continue;
      }
      ctx.beginPath();
      ctx.arc(point.x, point.y, poi.selected === true ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = poi.selected === true ? "#5aa9ff" : poi.color;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(5, 8, 12, 0.9)";
      ctx.stroke();
    }

    // 位置/朝向箭头（目标越界时夹回视窗边缘，保持方位指示）。
    if (playerXZ !== null) {
      const rawPoint = toCanvas(playerXZ);
      const point = {
        x: Math.min(Math.max(rawPoint.x, 8), sizePx - 8),
        y: Math.min(Math.max(rawPoint.y, 8), sizePx - 8),
      };
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.rotate(playerYaw ?? 0);
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(5, 5.5);
      ctx.lineTo(0, 2.8);
      ctx.lineTo(-5, 5.5);
      ctx.closePath();
      ctx.fillStyle = "#5aa9ff";
      ctx.strokeStyle = "rgba(5, 8, 12, 0.9)";
      ctx.lineWidth = 1.2;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  });

  const coords = playerXZ !== null ? pipelineWorldDisplayCoords(playerXZ) : null;

  return (
    <div className="minimap-hud" role="img" aria-label={t("minimap.title")}>
      <canvas
        ref={canvasRef}
        className="minimap-canvas"
        style={{ width: sizePx, height: sizePx }}
      />
      {coords !== null ? (
        <div className="minimap-coords">
          X {coords.x.toFixed(0)} · Z {coords.y.toFixed(0)}
        </div>
      ) : null}
    </div>
  );
}

/** 小地图边长（CSS 像素）。 */
export const MINIMAP_SIZE_PX = 172;

/**
 * 小地图 HUD 容器：从数据层取当前 3D 楼层的俯视贴图与同源 POI/区域数据，
 * 数据就绪且大地图未打开时渲染（与原版一致：大地图打开时隐藏小地图）。
 */
export function MinimapHudContainer() {
  const status = useMapStore((state) => state.status);
  const bigmapOpen = useUiStore((state) => state.bigmapOpen);
  const cameraHud = useUiStore((state) => state.cameraHud);
  const bundle = useMapDataStore((state) => state.bundle);
  const poiData = useMapDataStore((state) => state.poiData);
  const floor = useFloorStore((state) => state.floor);
  const hiddenCategories = usePoiFilterStore((state) => state.hiddenCategories);
  const selectedPoiId = usePoiStore((state) => state.selectedPoiId);

  const pkg = bundle?.pkg ?? null;

  // 楼层条目 + 标定 + 底图 object URL（与大地图共用 resolveFloorEntry/getIconObjectUrl）。
  const floorEntry: RawMap2dFloor | null = useMemo(() => {
    if (poiData === null) {
      return null;
    }
    return resolveFloorEntry(poiData.map2d, floor);
  }, [poiData, floor]);

  const imageUrl = useMemo(() => {
    if (pkg === null || floorEntry === null || !pkg.has(floorEntry.image)) {
      return null;
    }
    return getIconObjectUrl(pkg, floorEntry.image) ?? null;
  }, [pkg, floorEntry]);

  const calibration = useMemo(() => {
    return floorEntry !== null ? floorCalibrationOf(floorEntry) : null;
  }, [floorEntry]);

  const imageSize = useMemo(() => {
    if (floorEntry === null) {
      return null;
    }
    return { width: floorEntry.imageSize[0] ?? 0, height: floorEntry.imageSize[1] ?? 0 };
  }, [floorEntry]);

  // POI：与 2D 大地图同一份筛选源（分类隐藏 + 当前楼层 + hideInBigmap）。
  const pois = useMemo(() => {
    if (poiData === null) {
      return [];
    }
    return filterPois(poiData.pois, { hiddenCategories, floor })
      .filter((poi) => poi.hiddenInBigmap !== true)
      .map((poi) => ({
        id: poi.id,
        world: { x: poi.position.x, z: poi.position.z },
        color:
          poiData.categories.find((category) => category.id === poi.categoryId)?.color ?? "#8fa3b8",
        selected: poi.id === selectedPoiId,
      }));
  }, [poiData, hiddenCategories, floor, selectedPoiId]);

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

  if (status !== "ready" || bigmapOpen || poiData === null || calibration === null) {
    return null;
  }
  return (
    <MinimapHud
      imageUrl={imageUrl}
      imageSize={imageSize}
      calibration={calibration}
      pois={pois}
      regions={regions}
      playerXZ={cameraHud === null ? null : { x: cameraHud.position.x, z: cameraHud.position.z }}
      playerYaw={cameraHud?.yaw ?? null}
      sizePx={MINIMAP_SIZE_PX}
    />
  );
}

/** 楼层条目 → 小地图投影标定（与大地图 floorCalibration 同构）。 */
function floorCalibrationOf(entry: RawMap2dFloor): BigmapCalibration {
  return {
    worldMinX: entry.worldMinXZ.x,
    worldMaxX: entry.worldMaxXZ.x,
    worldMinZ: entry.worldMinXZ.z,
    worldMaxZ: entry.worldMaxXZ.z,
    imageWidthPx: entry.pixelW,
    imageHeightPx: entry.pixelH,
  };
}

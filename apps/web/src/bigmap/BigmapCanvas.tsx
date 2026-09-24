import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { pipelinePixelToWorld, pipelineWorldToUv } from "./project";
import { MAX_ZOOM_INDEX, MIN_ZOOM_INDEX, nextStepIndex, ZOOM_STEPS } from "./zoomSteps";
import type { BigmapCalibration, WorldXZ } from "./types";

/** 2D 底图上的 POI 标记（图标位图由父层解析后传入）。 */
export interface BigmapPoiMarker {
  readonly id: string;
  readonly world: WorldXZ;
  readonly color: string;
  readonly icon?: HTMLImageElement | null;
  readonly selected?: boolean;
}

/** 2D 底图上的区域名标注。 */
export interface BigmapRegionLabel {
  readonly id: string;
  readonly world: WorldXZ;
  readonly name: string;
}

/** 父层可持有的命令句柄（缩放按钮/滑杆/复位）。 */
export interface BigmapController {
  zoomIn(): void;
  zoomOut(): void;
  /** 直接跳到缩放档位（比例尺滑杆驱动）。 */
  setZoomStep(index: number): void;
  resetView(): void;
}

export interface BigmapCanvasProps {
  /** 烘焙俯视图 object URL（null 时仅绘制占位背景）。 */
  imageUrl: string | null;
  imageSize: { readonly width: number; readonly height: number } | null;
  /** 当前楼层的投影标定（管线世界系）。 */
  calibration: BigmapCalibration | null;
  pois: readonly BigmapPoiMarker[];
  regions: readonly BigmapRegionLabel[];
  /** 选中的区域（高亮显示；与 POI 选中互不干扰）。 */
  selectedRegionId?: string | null;
  playerXZ: WorldXZ | null;
  /** 视角朝向（弧度）：0 = 画面上方（世界 -Z），正值顺时针（东）。 */
  playerYaw: number | null;
  marker: WorldXZ | null;
  onSelectPoi: (poiId: string | null) => void;
  onPlaceMarker: (world: WorldXZ) => void;
  /** 区域名点击（高亮 + 3D 定位）；null 表示清除选中（点击空白）。 */
  onSelectRegion?: (regionId: string | null) => void;
  /** 缩放档位变化回调（滚轮/按钮/滑杆/复位共用，供滑杆回显）。 */
  onZoomChange?: (stepIndex: number) => void;
  /** 外部命令句柄挂载点。 */
  controllerRef?: { current: BigmapController | null };
}

interface ViewState {
  /** 相对“适配窗口”基准的缩放倍数（恒为 ZOOM_STEPS 档位值）。 */
  zoom: number;
  /** 画布 CSS 像素坐标系下的平移。 */
  offsetX: number;
  offsetY: number;
}

const POI_HIT_RADIUS_PX = 16;
const REGION_HIT_PAD_PX = 6;
const POI_DRAW_SIZE = 22;
const CLICK_SLOP_PX = 4;

/** 屏幕空间命中用的区域标注盒（绘制时记录）。 */
interface RegionHitBox {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly halfWidth: number;
}

/**
 * 2D 俯视大地图画布：单层烘焙整图 + 覆盖层（POI/区域/视角箭头/标记），
 * 仿射缩放平移（滚轮以光标为锚、拖拽平移、档位化缩放），无瓦片、无第三方地图库。
 */
export function BigmapCanvas(props: BigmapCanvasProps) {
  const {
    imageUrl,
    imageSize,
    calibration,
    pois,
    regions,
    selectedRegionId,
    playerXZ,
    playerYaw,
    marker,
    onSelectPoi,
    onPlaceMarker,
    onSelectRegion,
    onZoomChange,
    controllerRef,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<ViewState>({ zoom: 1, offsetX: 0, offsetY: 0 });
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    moved: boolean;
  } | null>(null);
  const sizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const regionHitsRef = useRef<RegionHitBox[]>([]);
  // 回调经 ref 转发，避免绘制闭包与命令句柄因回调身份变化反复重建。
  const onSelectRegionRef = useRef(onSelectRegion);
  onSelectRegionRef.current = onSelectRegion;
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = sizeRef.current;
    if (width === 0 || height === 0) {
      return;
    }
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#080c11";
    ctx.fillRect(0, 0, width, height);

    const image = imageRef.current;
    if (image === null || imageSize === null || calibration === null) {
      regionHitsRef.current = [];
      return;
    }
    const view = viewRef.current;
    const baseScale = Math.min(width / imageSize.width, height / imageSize.height);
    const scale = baseScale * view.zoom;
    const drawW = imageSize.width * scale;
    const drawH = imageSize.height * scale;

    const toScreen = (world: WorldXZ): { x: number; y: number } => {
      const uv = pipelineWorldToUv(world, calibration);
      return { x: uv.u * drawW + view.offsetX, y: uv.v * drawH + view.offsetY };
    };

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, view.offsetX, view.offsetY, drawW, drawH);

    // 区域名标注层：屏幕空间描边文字，字号不随缩放变化；选中区域高亮。
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    regionHitsRef.current = [];
    for (const region of regions) {
      const point = toScreen(region.world);
      if (point.x < -60 || point.x > width + 60 || point.y < -20 || point.y > height + 20) {
        continue;
      }
      const selected = region.id === selectedRegionId;
      ctx.font = selected
        ? '700 14px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
        : '600 13px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(5, 8, 12, 0.85)";
      ctx.strokeText(region.name, point.x, point.y);
      ctx.fillStyle = selected ? "#5aa9ff" : "rgba(219, 231, 243, 0.92)";
      ctx.fillText(region.name, point.x, point.y);
      if (selected) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
        ctx.strokeStyle = "#5aa9ff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      const halfWidth = ctx.measureText(region.name).width / 2 + REGION_HIT_PAD_PX;
      regionHitsRef.current.push({ id: region.id, x: point.x, y: point.y, halfWidth });
    }

    // POI 图标层。
    for (const poi of pois) {
      const point = toScreen(poi.world);
      const size = poi.selected === true ? POI_DRAW_SIZE + 8 : POI_DRAW_SIZE;
      const half = size / 2;
      if (point.x < -size || point.x > width + size || point.y < -size || point.y > height + size) {
        continue;
      }
      ctx.beginPath();
      ctx.arc(point.x, point.y, half + 2, 0, Math.PI * 2);
      ctx.fillStyle = poi.selected === true ? "#5aa9ff" : "rgba(8, 12, 17, 0.72)";
      ctx.fill();
      ctx.lineWidth = poi.selected === true ? 2 : 1;
      ctx.strokeStyle = poi.color;
      ctx.stroke();
      const icon = poi.icon;
      if (icon !== undefined && icon !== null && icon.complete && icon.naturalWidth > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(point.x, point.y, half, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(icon, point.x - half, point.y - half, size, size);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(point.x, point.y, Math.max(2, half - 6), 0, Math.PI * 2);
        ctx.fillStyle = poi.color;
        ctx.fill();
      }
    }

    // 视角（相机）位置箭头。
    if (playerXZ !== null) {
      const point = toScreen(playerXZ);
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.rotate(playerYaw ?? 0);
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(6.5, 7);
      ctx.lineTo(0, 3.5);
      ctx.lineTo(-6.5, 7);
      ctx.closePath();
      ctx.fillStyle = "#5aa9ff";
      ctx.strokeStyle = "rgba(5, 8, 12, 0.9)";
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // 右键标记 + 世界坐标读数。
    if (marker !== null) {
      const point = toScreen(marker);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#ff6b6b";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.font = '11px "PingFang SC", system-ui, sans-serif';
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      const label = `X ${marker.x.toFixed(1)}  Z ${marker.z.toFixed(1)}`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(5, 8, 12, 0.85)";
      ctx.strokeText(label, point.x + 10, point.y - 8);
      ctx.fillStyle = "#dbe7f3";
      ctx.fillText(label, point.x + 10, point.y - 8);
    }
  }, [calibration, imageSize, marker, playerXZ, playerYaw, pois, regions, selectedRegionId]);

  // 底图加载：换图/换层后复位视图（含缩放档位回调归零）。
  // 依赖只有 imageUrl：draw 身份随覆盖层数据变化（图标解码/相机 HUD 等），
  // 若把它列入依赖会让底图反复重解码并把用户缩放/平移瞬间复位（Batch2.5 修复）。
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  });
  useEffect(() => {
    if (imageUrl === null) {
      imageRef.current = null;
      drawRef.current();
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
        viewRef.current = { zoom: 1, offsetX: 0, offsetY: 0 };
        onZoomChangeRef.current?.(MIN_ZOOM_INDEX);
        drawRef.current();
      })
      .catch(() => {
        if (!cancelled) {
          imageRef.current = null;
          drawRef.current();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  // 画布尺寸自适应。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const host = canvas.parentElement;
    if (host === null) {
      return;
    }
    const observer = new ResizeObserver(() => {
      sizeRef.current = { width: host.clientWidth, height: host.clientHeight };
      draw();
    });
    observer.observe(host);
    sizeRef.current = { width: host.clientWidth, height: host.clientHeight };
    draw();
    return () => observer.disconnect();
  }, [draw]);

  // 数据/交互引起的变化重绘。
  useEffect(() => {
    draw();
  }, [draw]);

  /** 跳到缩放档位（锚点为中心或光标位置）。 */
  const zoomToStep = useCallback(
    (index: number, anchorX: number | null, anchorY: number | null) => {
      const view = viewRef.current;
      const clamped = Math.min(MAX_ZOOM_INDEX, Math.max(MIN_ZOOM_INDEX, Math.round(index)));
      const nextZoom = ZOOM_STEPS[clamped] ?? 1;
      if (nextZoom === view.zoom) {
        return;
      }
      const effective = nextZoom / view.zoom;
      const anchorXValue = anchorX ?? sizeRef.current.width / 2;
      const anchorYValue = anchorY ?? sizeRef.current.height / 2;
      view.offsetX = anchorXValue - (anchorXValue - view.offsetX) * effective;
      view.offsetY = anchorYValue - (anchorYValue - view.offsetY) * effective;
      view.zoom = nextZoom;
      draw();
      // 滑杆回显同步：按钮/滚轮驱动的档位变化同样上报（与滑杆/复位共用档位表）。
      onZoomChangeRef.current?.(clamped);
    },
    [draw],
  );

  useEffect(() => {
    if (controllerRef === undefined) {
      return;
    }
    controllerRef.current = {
      zoomIn: () => zoomToStep(nextStepIndex(viewRef.current.zoom, 1), null, null),
      zoomOut: () => zoomToStep(nextStepIndex(viewRef.current.zoom, -1), null, null),
      setZoomStep: (index) => zoomToStep(index, null, null),
      resetView: () => {
        viewRef.current = { zoom: 1, offsetX: 0, offsetY: 0 };
        onZoomChangeRef.current?.(MIN_ZOOM_INDEX);
        draw();
      },
    };
    return () => {
      controllerRef.current = null;
    };
  }, [controllerRef, zoomToStep, draw]);

  /** CSS 像素 → 底图 UV（含当前视图变换）。 */
  const screenToUv = useCallback(
    (clientX: number, clientY: number): { u: number; v: number } | null => {
      const canvas = canvasRef.current;
      if (canvas === null || imageSize === null) {
        return null;
      }
      const rect = canvas.getBoundingClientRect();
      const view = viewRef.current;
      const baseScale = Math.min(rect.width / imageSize.width, rect.height / imageSize.height);
      const scale = baseScale * view.zoom;
      return {
        u: (clientX - rect.left - view.offsetX) / (imageSize.width * scale),
        v: (clientY - rect.top - view.offsetY) / (imageSize.height * scale),
      };
    },
    [imageSize],
  );

  /** 当前视图变换下的“底图绘制宽高”（命中检测用）。 */
  const currentDrawSize = useCallback(
    (rectWidth: number, rectHeight: number): { drawW: number; drawH: number } | null => {
      if (imageSize === null) {
        return null;
      }
      const baseScale = Math.min(rectWidth / imageSize.width, rectHeight / imageSize.height);
      const scale = baseScale * viewRef.current.zoom;
      return { drawW: imageSize.width * scale, drawH: imageSize.height * scale };
    },
    [imageSize],
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: viewRef.current.offsetX,
      baseY: viewRef.current.offsetY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > CLICK_SLOP_PX) {
      drag.moved = true;
    }
    if (drag.moved) {
      viewRef.current.offsetX = drag.baseX + dx;
      viewRef.current.offsetY = drag.baseY + dy;
      draw();
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag === null || drag.pointerId !== event.pointerId || drag.moved || calibration === null) {
      return;
    }
    // 命中检测：半径内最近的 POI 优先，其次区域名标注盒。
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const drawSize = currentDrawSize(rect.width, rect.height);
    if (drawSize !== null) {
      let bestId: string | null = null;
      let bestDistance = POI_HIT_RADIUS_PX;
      for (const poi of pois) {
        const poiUv = pipelineWorldToUv(poi.world, calibration);
        const sx = poiUv.u * drawSize.drawW + viewRef.current.offsetX;
        const sy = poiUv.v * drawSize.drawH + viewRef.current.offsetY;
        const distance = Math.hypot(sx - px, sy - py);
        if (distance <= bestDistance) {
          bestDistance = distance;
          bestId = poi.id;
        }
      }
      if (bestId !== null) {
        onSelectPoi(bestId);
        return;
      }
    }
    for (const hit of regionHitsRef.current) {
      if (Math.abs(px - hit.x) <= hit.halfWidth && Math.abs(py - hit.y) <= 10) {
        onSelectRegionRef.current?.(hit.id);
        return;
      }
    }
    const uv = screenToUv(event.clientX, event.clientY);
    if (uv === null) {
      return;
    }
    onSelectPoi(null);
    onSelectRegionRef.current?.(null);
    onPlaceMarker(
      pipelinePixelToWorld(
        { x: uv.u * calibration.imageWidthPx, y: uv.v * calibration.imageHeightPx },
        calibration,
      ),
    );
  };

  // 滚轮缩放：原生非被动监听（React 根委托的 wheel 为 passive，preventDefault 会失效并报错）。
  const zoomToStepRef = useRef(zoomToStep);
  useEffect(() => {
    zoomToStepRef.current = zoomToStep;
  });
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const handleWheelNative = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const direction = event.deltaY < 0 ? 1 : -1;
      zoomToStepRef.current(
        nextStepIndex(viewRef.current.zoom, direction),
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    };
    canvas.addEventListener("wheel", handleWheelNative, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheelNative);
  }, []);

  const handleContextMenu = (event: React.MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    if (calibration === null) {
      return;
    }
    const uv = screenToUv(event.clientX, event.clientY);
    if (uv === null) {
      return;
    }
    onPlaceMarker(
      pipelinePixelToWorld(
        { x: uv.u * calibration.imageWidthPx, y: uv.v * calibration.imageHeightPx },
        calibration,
      ),
    );
  };

  return (
    <canvas
      ref={canvasRef}
      className="bigmap-canvas"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
      onContextMenu={handleContextMenu}
    />
  );
}

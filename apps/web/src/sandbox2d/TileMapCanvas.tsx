/**
 * 2D 沙盘瓦片画布：平移/缩放/命中/右键弹窗/悬停提示/flyTo。
 *
 * 交互骨架仿 BigmapCanvas 模式（pointer capture 拖拽、CLICK_SLOP 判定、滚轮原生
 * 非被动监听、命令句柄、ResizeObserver），但瓦片金字塔语义独立实现（设计 §1.1 裁决：
 * 不改造 BigmapCanvas）。交互参数为上游数据实测口径：
 * - zoom 1–6 整数档；滚轮累积 wheelPxPerZoomLevel=40、wheelDebounceTime=80ms（去抖后取整应用）
 * - maxBoundsViscosity=0.5：越界阻尼（拖拽期间越界位移减半），释放后动画回弹
 * - 楼层叠加 opacity 0.8；标记 32px（选中 48px）、方角、bgColor 底/白边、选中绿边 #0FF796
 * - 具名点位悬停提示：direction top、offset [0,-22]、深底 #07181B（触屏不出）
 * - 区域名标签常驻 12px 白 80%；点击 flyTo(该点, zoom 3, 0.5s)
 * - 空白单击：清空搜索/选中/弹窗 + setView 居中到点击点（zoom 不变、瞬时）
 * - 仅主键（左键）参与拖拽/点击；右键只开坐标弹窗（数据由父层渲染 SandboxCoordinatePopup，
 *   本组件只上报全分辨率坐标）
 *
 * 视图态为组件 state + 按图跨挂载缓存（rAF 节流的 setView 驱动重绘与瓦片清单派生；
 * 拖拽/飞行动画逐帧更新；3D↔2D 切换保留、换图复位——与过滤态同一语义）。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Sandbox2dPackage } from "./loadSandbox2d";
import type { Sandbox2dData, SandboxPoint } from "./types";
import { useSandboxImages } from "./useTileImages";
import {
  clampPan,
  dampPan,
  flyEase,
  MAX_ZOOM,
  MIN_ZOOM,
  overlayToFullRes,
  pointToFullRes,
  regionToFullRes,
  zoomScale,
} from "./project";
import { tileScreenRect, tilesForViewport, worldScreenSize } from "./tileGrid";

/** 父层可持有的命令句柄。 */
export interface TileMapController {
  zoomIn(): void;
  zoomOut(): void;
  /** 居中到全分辨率坐标（flyTo：0.5s 缓动；目标 zoom 缺省 3——区域点击口径）。 */
  flyTo(sx: number, sy: number, zoom?: number): void;
  /** 视图复位（zoom 1 居中）。 */
  resetView(): void;
}

export interface TileMapCanvasProps {
  pkg: Sandbox2dPackage | null;
  data: Sandbox2dData | null;
  /** 视图态归属图（mapId）：跨挂载保留平移/缩放，换图复位；null = 不缓存。 */
  viewKey: number | null;
  /** 当前站点楼层（undefined = All/全图）。 */
  siteFloor: number | undefined;
  /** 过滤后的可见点位（含未上图的无 media 点——命中只认有 media 的标记）。 */
  points: readonly SandboxPoint[];
  selectedPointId: number | null;
  /** 具名点位搜索选中（高亮口径：按选中样式绘制）。 */
  searchTarget: { item: string; x: number; y: number } | null;
  selectedRegionId: string | null;
  /** 区域名（已按语言解析）。 */
  regionNames: ReadonlyMap<string, string>;
  /** POI 显示名（已按语言解析的 name||title 链；null = 无提示）。 */
  pointLabel: (point: SandboxPoint) => string | null;
  onSelectPoint: (pointId: number | null) => void;
  onSelectRegion: (regionId: string | null) => void;
  /** 空白左键单击：清空搜索/选中（弹窗由 onCoordinatePopup(null) 关闭）。 */
  onBlankClick: () => void;
  /** 右键坐标弹窗（全分辨率坐标 + 弹窗锚点屏幕位置）；null = 关闭。 */
  onCoordinatePopup: (
    popup: { sx: number; sy: number; screenX: number; screenY: number } | null,
  ) => void;
  controllerRef?: { current: TileMapController | null };
}

interface ViewState {
  zoom: number;
  /** null = 自动居中（初始/复位口径：世界中心对视口中心——Leaflet setView(center) 语义）。 */
  offsetX: number | null;
  offsetY: number | null;
}

const DEFAULT_VIEW: ViewState = { zoom: MIN_ZOOM, offsetX: null, offsetY: null };

/**
 * 视图态跨挂载缓存（按图隔离）：2D↔3D 切换 = 卸载/重挂载，平移/缩放在此存活；
 * 换图由 viewKey 变化触发复位——与沙盘过滤态「仅换图复位」同一语义。
 */
const viewStateCache = new Map<number, ViewState>();

interface ResolvedView {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

/** 解析视图：null 偏移 → 世界在视口内居中。 */
function resolveView(view: ViewState, size: { width: number; height: number }): ResolvedView {
  const world = worldScreenSize(view.zoom);
  return {
    zoom: view.zoom,
    offsetX: view.offsetX ?? (size.width - world.width) / 2,
    offsetY: view.offsetY ?? (size.height - world.height) / 2,
  };
}

const CLICK_SLOP_PX = 4;
const POI_HIT_RADIUS_PX = 16;
const REGION_HIT_PAD_PX = 6;
const MARKER_SIZE = 32;
const MARKER_SIZE_SELECTED = 48;
const WHEEL_PX_PER_ZOOM = 40;
const WHEEL_DEBOUNCE_MS = 80;
const BOUNDS_VISCOSITY = 0.5;
const FLY_DURATION_MS = 500;
const SNAP_BACK_MS = 300;
const FLY_TARGET_ZOOM = 3;
const MARKER_FALLBACK_BG = "#26323a"; // #161E23 提亮 1.5 倍的近似（brightness(1.5) 口径）
const ACCENT = "#0FF796";

interface MarkerHit {
  pointId: number;
  x: number;
  y: number;
  radius: number;
}

interface RegionHit {
  regionId: string;
  x: number;
  y: number;
  halfWidth: number;
}

export function TileMapCanvas(props: TileMapCanvasProps) {
  const {
    pkg,
    data,
    viewKey,
    siteFloor,
    points,
    selectedPointId,
    searchTarget,
    selectedRegionId,
    regionNames,
    pointLabel,
    onSelectPoint,
    onSelectRegion,
    onBlankClick,
    onCoordinatePopup,
    controllerRef,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 偏移 null = 自动居中（Leaflet 初始 setView(center) 语义）；交互开始即固化为具体值。
  // 初始值取本图缓存（3D↔2D 往返保留），无缓存走默认居中。
  const [view, setView] = useState<ViewState>(() =>
    viewKey === null ? DEFAULT_VIEW : (viewStateCache.get(viewKey) ?? DEFAULT_VIEW),
  );
  const [size, setSize] = useState({ width: 0, height: 0 });
  // 视图态镜像写入缓存（卸载后保留；换图由下方 viewKey 效应复位）
  const viewKeyRef = useRef(viewKey);
  useEffect(() => {
    if (viewKey === viewKeyRef.current) {
      return;
    }
    viewKeyRef.current = viewKey;
    // 换图：复位视图（图间坐标/瓦片不通用，沿用过滤态的「仅换图复位」语义）
    setView(DEFAULT_VIEW);
  }, [viewKey]);
  useEffect(() => {
    if (viewKey !== null) {
      viewStateCache.set(viewKey, view);
    }
  }, [viewKey, view]);
  const markersRef = useRef<MarkerHit[]>([]);
  const regionsRef = useRef<RegionHit[]>([]);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    moved: boolean;
  } | null>(null);
  const hoverRef = useRef<{ pointId: number; label: string } | null>(null);
  const animRef = useRef<number | null>(null);
  // 飞行动画的无帧兜底定时器（后台页/无渲染帧环境 rAF 不推进时按墙钟推进）
  const animTimerRef = useRef<number | null>(null);
  const wheelAccRef = useRef(0);
  const wheelTimerRef = useRef<number | null>(null);
  // 视图镜像（供原生 wheel 监听/rAF/超时等非渲染闭包读取最新值）
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  /** 解析后的视图（null 偏移 → 世界在视口内居中——任意尺寸下初始口径）。 */
  const resolved = useMemo(() => resolveView(view, size), [view, size]);
  const resolvedRef = useRef(resolved);
  useEffect(() => {
    resolvedRef.current = resolved;
  }, [resolved]);

  // ---- 视口 → 瓦片/叠加/标记位图清单 ----
  const imageFiles = useMemo(() => {
    if (pkg === null || data === null) {
      return [] as readonly string[];
    }
    const files: string[] = tilesForViewport(
      data.meta.tileTemplate,
      {
        width: size.width,
        height: size.height,
        offsetX: resolved.offsetX,
        offsetY: resolved.offsetY,
        zoom: resolved.zoom,
      },
      siteFloor,
    ).map((tile) => tile.file);
    if (siteFloor !== undefined) {
      for (const overlay of data.overlays) {
        if (overlay.floor === siteFloor) {
          files.push(overlay.file);
        }
      }
    }
    for (const point of points) {
      if (point.media !== null) {
        files.push(point.media);
      }
    }
    return [...new Set(files)];
  }, [pkg, data, siteFloor, points, resolved, size]);

  const images = useSandboxImages(pkg, imageFiles);

  // ---- 绘制 ----
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
    const { width, height } = size;
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
    // 底色 + 顶部渐晕（MapContainer backgroundColor/linear-gradient 口径）
    ctx.fillStyle = "#1E2529";
    ctx.fillRect(0, 0, width, height);
    const gradient = ctx.createLinearGradient(0, 0, 0, Math.min(312, height));
    gradient.addColorStop(0, "rgba(15, 247, 150, 0.1)");
    gradient.addColorStop(1, "rgba(15, 247, 150, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, Math.min(312, height));

    if (pkg === null || data === null) {
      markersRef.current = [];
      regionsRef.current = [];
      return;
    }
    const scale = zoomScale(resolved.zoom);
    const toScreen = (sx: number, sy: number): { x: number; y: number } => ({
      x: sx * scale + resolved.offsetX,
      y: sy * scale + resolved.offsetY,
    });
    const viewport = {
      width,
      height,
      offsetX: resolved.offsetX,
      offsetY: resolved.offsetY,
      zoom: resolved.zoom,
    };

    // 1) 瓦片
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    for (const tile of tilesForViewport(data.meta.tileTemplate, viewport, siteFloor)) {
      const image = images.get(tile.file);
      const rect = tileScreenRect(tile, viewport);
      if (image !== undefined && image.complete && image.naturalWidth > 0) {
        ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h);
      }
    }

    // 2) 楼层叠加（仅具体楼层；opacity 0.8）
    if (siteFloor !== undefined) {
      ctx.globalAlpha = 0.8;
      for (const overlay of data.overlays) {
        if (overlay.floor !== siteFloor) {
          continue;
        }
        const image = images.get(overlay.file);
        if (image === undefined || !image.complete || image.naturalWidth === 0) {
          continue;
        }
        const rect = overlayToFullRes(overlay);
        const p0 = toScreen(rect.x0, rect.y0);
        ctx.drawImage(image, p0.x, p0.y, rect.w * scale, rect.h * scale);
      }
      ctx.globalAlpha = 1;
    }

    // 3) POI 标记（仅有 media 的点位上图——无图位跳过口径）
    const searchTargetValue = searchTarget;
    markersRef.current = [];
    interface MarkerEntry {
      point: SandboxPoint;
      x: number;
      y: number;
      size: number;
      accent: boolean;
      image: HTMLImageElement | undefined;
    }
    const normalMarkers: MarkerEntry[] = [];
    const accentMarkers: MarkerEntry[] = [];
    for (const point of points) {
      if (point.media === null) {
        continue;
      }
      const full = pointToFullRes(point.x, point.y);
      const screen = toScreen(full.sx, full.sy);
      if (
        screen.x < -MARKER_SIZE_SELECTED ||
        screen.x > width + MARKER_SIZE_SELECTED ||
        screen.y < -MARKER_SIZE_SELECTED ||
        screen.y > height + MARKER_SIZE_SELECTED
      ) {
        continue;
      }
      const isSearchTarget =
        searchTargetValue !== null &&
        point.item === searchTargetValue.item &&
        point.x === searchTargetValue.x &&
        point.y === searchTargetValue.y;
      const accent = point.id === selectedPointId || isSearchTarget;
      const markerSize = accent ? MARKER_SIZE_SELECTED : MARKER_SIZE;
      markersRef.current.push({
        pointId: point.id,
        x: screen.x,
        y: screen.y,
        radius: markerSize / 2,
      });
      const entry: MarkerEntry = {
        point,
        x: screen.x,
        y: screen.y,
        size: markerSize,
        accent,
        image: images.get(point.media),
      };
      (accent ? accentMarkers : normalMarkers).push(entry);
    }
    const drawMarker = (entry: MarkerEntry) => {
      const { x, y, accent, image, point } = entry;
      const markerSize = entry.size;
      const half = markerSize / 2;
      ctx.save();
      ctx.shadowColor = "rgba(0, 0, 0, 1)";
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 6;
      ctx.fillStyle = point.bgColor ?? MARKER_FALLBACK_BG;
      ctx.fillRect(x - half, y - half, markerSize, markerSize);
      ctx.restore();
      ctx.lineWidth = 1;
      ctx.strokeStyle = accent ? ACCENT : "#ffffff";
      ctx.strokeRect(x - half + 0.5, y - half + 0.5, markerSize - 1, markerSize - 1);
      const pad = point.bgColor !== null ? 3.2 : 0;
      if (image !== undefined && image.complete && image.naturalWidth > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x - half + pad, y - half + pad, markerSize - pad * 2, markerSize - pad * 2);
        ctx.clip();
        ctx.drawImage(
          image,
          x - half + pad,
          y - half + pad,
          markerSize - pad * 2,
          markerSize - pad * 2,
        );
        ctx.restore();
      }
    };
    for (const entry of normalMarkers) {
      drawMarker(entry);
    }

    // 4) 区域名标签（常驻 12px 白 80%；选中态高亮下划线）
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = '500 12px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    regionsRef.current = [];
    for (const region of data.regions) {
      const name = regionNames.get(region.id);
      if (name === undefined) {
        continue;
      }
      const full = regionToFullRes(region.x, region.y);
      const screen = toScreen(full.sx, full.sy);
      if (screen.x < -80 || screen.x > width + 80 || screen.y < -20 || screen.y > height + 20) {
        continue;
      }
      const selected = region.id === selectedRegionId;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(5, 8, 12, 0.85)";
      ctx.strokeText(name, screen.x, screen.y);
      ctx.fillStyle = selected ? ACCENT : "rgba(255, 255, 255, 0.8)";
      ctx.fillText(name, screen.x, screen.y);
      const textWidth = ctx.measureText(name).width;
      if (selected) {
        ctx.fillRect(screen.x - textWidth / 2, screen.y + 10, textWidth, 2);
      }
      regionsRef.current.push({
        regionId: region.id,
        x: screen.x,
        y: screen.y,
        halfWidth: textWidth / 2 + REGION_HIT_PAD_PX,
      });
    }

    // 5) 选中/搜索目标标记最后绘制（选中标记层级高于区域标签）
    for (const entry of accentMarkers) {
      drawMarker(entry);
    }

    // 6) 悬停提示（direction top、offset [0,-22]、深底 #07181B；触屏不出）
    const hover = hoverRef.current;
    if (hover !== null && !isTouchDevice()) {
      const hit = markersRef.current.find((m) => m.pointId === hover.pointId);
      if (hit !== undefined) {
        ctx.font = '600 12px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
        const paddingX = 8;
        const textWidth = Math.min(ctx.measureText(hover.label).width, 360);
        const boxW = textWidth + paddingX * 2;
        const boxH = 24;
        const boxX = hit.x - boxW / 2;
        const boxY = hit.y - hit.radius - 22 - boxH;
        ctx.fillStyle = "#07181B";
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.lineWidth = 1;
        ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);
        ctx.fillStyle = "#ffffff";
        ctx.save();
        ctx.beginPath();
        ctx.rect(boxX + paddingX, boxY, textWidth, boxH);
        ctx.clip();
        ctx.fillText(hover.label, boxX + paddingX, boxY + boxH / 2);
        ctx.restore();
      }
    }
  }, [
    pkg,
    data,
    siteFloor,
    points,
    selectedPointId,
    searchTarget,
    selectedRegionId,
    regionNames,
    images,
    resolved,
    size,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  // 画布尺寸自适应：挂载即同步量测一次（layout 阶段），此后由 ResizeObserver 跟踪。
  // 不等 RO 初始回调的原因：其投递依赖渲染帧——无帧环境（后台页/无头测试）可能
  // 长期不达，画布会停在 0 尺寸（不绘制、变换探针全为伪值）。
  useLayoutEffect(() => {
    const host = canvasRef.current?.parentElement ?? null;
    if (host === null) {
      return;
    }
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width > 0 && height > 0) {
      setSize((prev) => (prev.width === 0 && prev.height === 0 ? { width, height } : prev));
    }
  }, []);
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
      setSize({ width: host.clientWidth, height: host.clientHeight });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // ---- 缩放 ----
  const cancelAnim = useCallback(() => {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
    if (animTimerRef.current !== null) {
      window.clearInterval(animTimerRef.current);
      animTimerRef.current = null;
    }
  }, []);

  const zoomTo = useCallback(
    (nextZoomRaw: number, anchorX: number | null, anchorY: number | null) => {
      setView((prev) => {
        const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(nextZoomRaw)));
        const prevResolved = resolveView(prev, size);
        if (nextZoom === prevResolved.zoom) {
          return prev;
        }
        const anchorXValue = anchorX ?? size.width / 2;
        const anchorYValue = anchorY ?? size.height / 2;
        const effective = zoomScale(nextZoom) / zoomScale(prevResolved.zoom);
        let offsetX = anchorXValue - (anchorXValue - prevResolved.offsetX) * effective;
        let offsetY = anchorYValue - (anchorYValue - prevResolved.offsetY) * effective;
        const world = worldScreenSize(nextZoom);
        const clamped = clampPan(
          offsetX,
          offsetY,
          size.width,
          size.height,
          world.width,
          world.height,
        );
        offsetX = clamped.x;
        offsetY = clamped.y;
        return { zoom: nextZoom, offsetX, offsetY };
      });
    },
    [size],
  );

  // 滚轮：累积 40px/档、80ms 去抖后应用（Leaflet wheelPxPerZoomLevel/wheelDebounceTime 口径）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      wheelAccRef.current += event.deltaY;
      if (wheelTimerRef.current !== null) {
        window.clearTimeout(wheelTimerRef.current);
      }
      const rect = canvas.getBoundingClientRect();
      const ax = event.clientX - rect.left;
      const ay = event.clientY - rect.top;
      wheelTimerRef.current = window.setTimeout(() => {
        const levels = Math.round(wheelAccRef.current / WHEEL_PX_PER_ZOOM);
        wheelAccRef.current = 0;
        if (levels !== 0) {
          zoomTo(viewRef.current.zoom + levels, ax, ay);
        }
      }, WHEEL_DEBOUNCE_MS);
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", handleWheel);
      if (wheelTimerRef.current !== null) {
        window.clearTimeout(wheelTimerRef.current);
      }
    };
  }, [zoomTo]);

  // ---- flyTo（0.5s；zoom 与位移同步缓动——duration 0.5/easeLinearity 0.25 手感）----
  // 视口尺寸：state 未量测（0）时先同步量 host（ResizeObserver 初始回调依赖渲染帧，
  // 无帧环境可能延迟，而程序化飞行——3D→2D 定位回放等——可能在挂载初期发出）；
  // 同步量测仍为 0（host 未布局）才挂起待补飞。
  const pendingFlyRef = useRef<{ sx: number; sy: number; zoom: number } | null>(null);
  const flyTo = useCallback(
    (sx: number, sy: number, targetZoom: number = FLY_TARGET_ZOOM) => {
      let viewportW = size.width;
      let viewportH = size.height;
      if (viewportW === 0 || viewportH === 0) {
        const host = canvasRef.current?.parentElement ?? null;
        if (host !== null) {
          viewportW = host.clientWidth;
          viewportH = host.clientHeight;
        }
      }
      if (viewportW === 0 || viewportH === 0) {
        pendingFlyRef.current = { sx, sy, zoom: targetZoom };
        // 挂起时主动请求一帧，解锁尺寸量测（ResizeObserver）与飞行动画的渲染帧。
        requestAnimationFrame(() => {});
        return;
      }
      cancelAnim();
      const world = worldScreenSize(targetZoom);
      const scale = zoomScale(targetZoom);
      const clamped = clampPan(
        viewportW / 2 - sx * scale,
        viewportH / 2 - sy * scale,
        viewportW,
        viewportH,
        world.width,
        world.height,
      );
      const from = resolveView(viewRef.current, { width: viewportW, height: viewportH });
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / FLY_DURATION_MS);
        const e = flyEase(t);
        setView({
          zoom: from.zoom + (targetZoom - from.zoom) * e,
          offsetX: from.offsetX + (clamped.x - from.offsetX) * e,
          offsetY: from.offsetY + (clamped.y - from.offsetY) * e,
        });
        if (t < 1) {
          if (animRef.current === null) {
            animRef.current = requestAnimationFrame(step);
          }
        } else {
          animRef.current = null;
          if (animTimerRef.current !== null) {
            window.clearInterval(animTimerRef.current);
            animTimerRef.current = null;
          }
        }
      };
      animRef.current = requestAnimationFrame(step);
      // 无帧兜底：step 按墙钟时间幂等推进，rAF 正常时定时器至多陪跑几拍；
      // rAF 完全不推进（后台页/无头环境）时由定时器完成飞行。
      animTimerRef.current = window.setInterval(() => {
        if (animRef.current === null) {
          if (animTimerRef.current !== null) {
            window.clearInterval(animTimerRef.current);
          }
          animTimerRef.current = null;
          return;
        }
        step(performance.now());
      }, 100);
    },
    [cancelAnim, size.width, size.height],
  );
  useEffect(() => {
    const pending = pendingFlyRef.current;
    if (pending !== null && size.width > 0 && size.height > 0) {
      pendingFlyRef.current = null;
      flyTo(pending.sx, pending.sy, pending.zoom);
    }
  }, [size, flyTo]);

  // 命令句柄
  useEffect(() => {
    if (controllerRef === undefined) {
      return;
    }
    controllerRef.current = {
      zoomIn: () => zoomTo(resolvedRef.current.zoom + 1, null, null),
      zoomOut: () => zoomTo(resolvedRef.current.zoom - 1, null, null),
      flyTo: (sx, sy, zoom) => flyTo(sx, sy, zoom),
      resetView: () => {
        cancelAnim();
        setView({ zoom: MIN_ZOOM, offsetX: null, offsetY: null });
      },
    };
    return () => {
      controllerRef.current = null;
    };
  }, [controllerRef, zoomTo, flyTo, cancelAnim]);

  // ---- 具名点位选中 → flyTo 居中（0.5s 缓动，zoom 不变——设计 §1.3 #5）----
  // 下拉每次选择（含重选同项，新对象引用）都触发；挂载恢复/纯视口尺寸变化不重飞
  //（恢复场景由视图态缓存还原位置）。
  const flyToRef = useRef(flyTo);
  useEffect(() => {
    flyToRef.current = flyTo;
  }, [flyTo]);
  const lastFlownTargetRef = useRef(searchTarget);
  useEffect(() => {
    // 视口未量测完成（宽 0）时跳过：飞行动画目标按视口夹取，0 尺寸会把偏移夹错。
    if (searchTarget === null || size.width === 0 || searchTarget === lastFlownTargetRef.current) {
      return;
    }
    lastFlownTargetRef.current = searchTarget;
    const full = pointToFullRes(searchTarget.x, searchTarget.y);
    flyToRef.current(full.sx, full.sy, viewRef.current.zoom);
  }, [searchTarget, size.width]);

  // ---- 拖拽（越界阻尼 + 释放回弹）----
  /** 越界时动画回弹到夹取位置（maxBounds 释放归位；未越界为 no-op）。 */
  const releaseSnapBack = useCallback(() => {
    const from = { ...resolvedRef.current };
    const world = worldScreenSize(from.zoom);
    const clamped = clampPan(
      from.offsetX,
      from.offsetY,
      size.width,
      size.height,
      world.width,
      world.height,
    );
    if (clamped.x === from.offsetX && clamped.y === from.offsetY) {
      return;
    }
    cancelAnim();
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / SNAP_BACK_MS);
      const e = flyEase(t);
      setView({
        zoom: from.zoom,
        offsetX: from.offsetX + (clamped.x - from.offsetX) * e,
        offsetY: from.offsetY + (clamped.y - from.offsetY) * e,
      });
      if (t < 1) {
        animRef.current = requestAnimationFrame(step);
      } else {
        animRef.current = null;
      }
    };
    animRef.current = requestAnimationFrame(step);
  }, [cancelAnim, size.width, size.height]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    // 仅主键（左键）进入拖拽/点击管线；右键/中键只走 contextmenu（坐标弹窗），
    // 不捕获指针——否则右键的 pointerup 会被当作点击清除弹窗/误开详情。
    if (event.button !== 0) {
      return;
    }
    cancelAnim();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: resolvedRef.current.offsetX,
      baseY: resolvedRef.current.offsetY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag === null) {
      // 悬停命中（无拖拽时）
      const rect = event.currentTarget.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      let hit: { pointId: number; label: string } | null = null;
      let best = POI_HIT_RADIUS_PX;
      for (const marker of markersRef.current) {
        const distance = Math.hypot(marker.x - px, marker.y - py);
        if (distance <= Math.max(best, marker.radius)) {
          best = distance;
          const point = points.find((p) => p.id === marker.pointId);
          const label = point !== undefined ? pointLabel(point) : null;
          if (label !== null) {
            hit = { pointId: marker.pointId, label };
          }
        }
      }
      const prev = hoverRef.current;
      hoverRef.current = hit;
      if (prev?.pointId !== hit?.pointId) {
        draw();
      }
      return;
    }
    if (drag.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > CLICK_SLOP_PX) {
      drag.moved = true;
    }
    if (drag.moved) {
      const world = worldScreenSize(viewRef.current.zoom);
      const target = { x: drag.baseX + dx, y: drag.baseY + dy };
      const clamped = clampPan(
        target.x,
        target.y,
        size.width,
        size.height,
        world.width,
        world.height,
      );
      const damped = dampPan(target, clamped, BOUNDS_VISCOSITY);
      setView((prev) => ({ ...prev, offsetX: damped.x, offsetY: damped.y }));
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    if (drag.moved) {
      releaseSnapBack();
      return;
    }
    // macOS ctrl+click = 右键语义（contextmenu 已开坐标弹窗），不当作左键点击。
    if (event.ctrlKey) {
      return;
    }
    // 点击：POI 优先（半径内最近）→ 区域名 → 空白居中
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    let bestId: number | null = null;
    let bestDistance = POI_HIT_RADIUS_PX;
    for (const marker of markersRef.current) {
      const distance = Math.hypot(marker.x - px, marker.y - py);
      if (distance <= Math.max(bestDistance, marker.radius)) {
        bestDistance = distance;
        bestId = marker.pointId;
      }
    }
    if (bestId !== null) {
      onSelectPoint(bestId);
      onCoordinatePopup(null);
      return;
    }
    for (const hit of regionsRef.current) {
      if (Math.abs(px - hit.x) <= hit.halfWidth && Math.abs(py - hit.y) <= 10) {
        onSelectRegion(hit.regionId);
        onCoordinatePopup(null);
        return;
      }
    }
    // 空白：清空搜索/选中/弹窗（弹窗经 onCoordinatePopup，搜索/选中经 onBlankClick）
    // + setView 居中到点击点（zoom 不变、瞬时）
    onCoordinatePopup(null);
    onBlankClick();
    const current = resolvedRef.current;
    const scale = zoomScale(current.zoom);
    const sx = (px - current.offsetX) / scale;
    const sy = (py - current.offsetY) / scale;
    const world = worldScreenSize(current.zoom);
    const clamped = clampPan(
      size.width / 2 - sx * scale,
      size.height / 2 - sy * scale,
      size.width,
      size.height,
      world.width,
      world.height,
    );
    setView({ zoom: current.zoom, offsetX: clamped.x, offsetY: clamped.y });
  };

  // 右键：坐标弹窗（上报全分辨率坐标；显示值 "x;y" 由 SandboxCoordinatePopup 按弹窗
  // 口径格式化——x=水平、y=自下而上，逆变换实测口径）
  const handleContextMenu = (event: React.MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const current = resolvedRef.current;
    const scale = zoomScale(current.zoom);
    const sx = (px - current.offsetX) / scale;
    const sy = (py - current.offsetY) / scale;
    onCoordinatePopup({ sx, sy, screenX: px, screenY: py });
  };

  return (
    <canvas
      ref={canvasRef}
      className="sandbox2d-canvas"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        dragRef.current = null;
        releaseSnapBack();
      }}
      onPointerLeave={() => {
        hoverRef.current = null;
        draw();
      }}
      onContextMenu={handleContextMenu}
    />
  );
}

function isTouchDevice(): boolean {
  return typeof window !== "undefined" && "ontouchstart" in window && navigator.maxTouchPoints > 0;
}

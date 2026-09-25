/**
 * 视口 → 瓦片清单（纯函数）。
 *
 * Leaflet TileLayer 口径：tileSize 512、minNativeZoom 1、maxNativeZoom 3、noWrap、
 * bounds=世界矩形。zoom > 3 时取 z3 瓦片按 2^(zoom−3) 放大绘制（上采样）。
 * 路径模板两种（meta.tileTemplate，模板占位符替换语义与 Leaflet 一致：{x}=列、{y}=行）：
 * - 四图 `tiles/{z}/{y}/{x}.webp`
 * - az3 `tiles/{floor}/{z}/{x}/{y}.webp`，floor ∈ base|1f|2f|3f（chunk 实证：
 *   未选楼层 → "base"；选站点楼层 f → (f+1)+"f"）
 */

import { MAX_ZOOM, MIN_ZOOM, NATIVE_MAX_ZOOM, TILE_SIZE, WORLD_SIZE, zoomScale } from "./project";

/** 一张待加载瓦片（容器内路径 + 绘制参数）。 */
export interface SandboxTile {
  /** 容器内条目路径。 */
  readonly file: string;
  /** 瓦片网格坐标（z 为原生层，col/row 为该层网格）。 */
  readonly z: number;
  readonly col: number;
  readonly row: number;
}

export interface TileViewport {
  /** 视口尺寸（CSS px）。 */
  readonly width: number;
  readonly height: number;
  /** 世界平面在视口内的偏移（世界原点相对视口左上角；可为负）。 */
  readonly offsetX: number;
  readonly offsetY: number;
  readonly zoom: number;
}

/** az3 楼层段：未选楼层("All") → base；站点楼层 f → (f+1)+"f"。 */
export function az3FloorSegment(siteFloor: number | undefined): string {
  return siteFloor === undefined ? "base" : `${siteFloor + 1}f`;
}

/** 是否 az3 整层换图模板。 */
export function isFloorTemplate(tileTemplate: string): boolean {
  return tileTemplate.includes("{floor}");
}

/** 模板替换（语义与 Leaflet 一致：{x}=列、{y}=行；{floor} 为 az3 楼层段）。 */
export function tilePath(
  tileTemplate: string,
  z: number,
  col: number,
  row: number,
  floorSegment: string,
): string {
  return tileTemplate
    .replaceAll("{floor}", floorSegment)
    .replaceAll("{z}", String(z))
    .replaceAll("{x}", String(col))
    .replaceAll("{y}", String(row));
}

/**
 * 当前视口 × zoom 需要的瓦片清单（z>3 降采样到 z3；世界边缘外无瓦片——noWrap）。
 */
export function tilesForViewport(
  tileTemplate: string,
  viewport: TileViewport,
  siteFloor: number | undefined,
): SandboxTile[] {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(viewport.zoom)));
  // 原生层：z>3 取 z3（上采样），z<1 取 z1
  const nativeZ = Math.min(NATIVE_MAX_ZOOM, Math.max(1, zoom));
  const floorSegment = isFloorTemplate(tileTemplate) ? az3FloorSegment(siteFloor) : "";
  // 原生层每张瓦片在当前 zoom 下的屏幕尺寸
  const tileScreen = (TILE_SIZE * zoomScale(zoom)) / zoomScale(nativeZ);
  // 视口覆盖的原生层网格范围（世界原点 = 视口偏移处）
  const minCol = Math.floor(-viewport.offsetX / tileScreen);
  const maxCol = Math.floor((viewport.width - viewport.offsetX) / tileScreen);
  const minRow = Math.floor(-viewport.offsetY / tileScreen);
  const maxRow = Math.floor((viewport.height - viewport.offsetY) / tileScreen);
  const grid = 2 ** nativeZ; // 该层网格边长（z1→2、z2→4、z3→8）
  const tiles: SandboxTile[] = [];
  for (let row = minRow; row <= maxRow; row += 1) {
    if (row < 0 || row >= grid) {
      continue; // noWrap：世界外无瓦片
    }
    for (let col = minCol; col <= maxCol; col += 1) {
      if (col < 0 || col >= grid) {
        continue;
      }
      tiles.push({
        file: tilePath(tileTemplate, nativeZ, col, row, floorSegment),
        z: nativeZ,
        col,
        row,
      });
    }
  }
  return tiles;
}

/** 当前 zoom 下世界的屏幕尺寸（px）。 */
export function worldScreenSize(zoom: number): { width: number; height: number } {
  const s = zoomScale(zoom);
  return { width: WORLD_SIZE * s, height: WORLD_SIZE * s };
}

/** 瓦片在视口内的绘制矩形（世界原点=offset；瓦片按当前 zoom 缩放）。 */
export function tileScreenRect(
  tile: SandboxTile,
  viewport: { offsetX: number; offsetY: number; zoom: number },
): { x: number; y: number; w: number; h: number } {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(viewport.zoom)));
  const scale = zoomScale(zoom) / zoomScale(tile.z);
  const w = TILE_SIZE * scale;
  return {
    x: viewport.offsetX + tile.col * w,
    y: viewport.offsetY + tile.row * w,
    w,
    h: w,
  };
}

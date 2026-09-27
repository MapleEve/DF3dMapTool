import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  type Texture,
} from "three";
import type { EngineLayer } from "./SceneManager";
import type { Vec3 } from "@/common/geometry";

/** 路线线上抬高度，避免与地面 z-fighting。 */
const ROUTE_Y_OFFSET = 0.4;

/** 主线：工具主绿（#0FF796）。 */
const ROUTE_LINE_COLOR = 0x0ff796;
/** 起点标记（浅蓝）与终点标记（暖黄）。 */
const START_COLOR = 0x8fd7ff;
const END_COLOR = 0xffc65c;
/** 路牌 sprite 世界尺寸（宽×高，米）。 */
const SIGN_WIDTH = 2.6;
const SIGN_HEIGHT = 3.4;
/** 路牌中心离地高度（米）。 */
const SIGN_Y_OFFSET = 2.4;
/** 路牌兜底色（贴图不可用时的纯色 sprite）。 */
const SIGN_COLOR = 0x0ff796;

/** 分段渲染：前方窗口与身后拖尾（点位数）。 */
export const SEGMENT_WINDOW_POINTS = 40;
export const SEGMENT_TRAIL_POINTS = 6;

/** 路线渲染模式：全程一次成线 / 跟跑分段（只画前方窗口，随进度推进）。 */
export type RouteRenderMode = "full" | "segment";

/**
 * 分段渲染的点位规模阈值（导航启动时按路线数据二选一）。
 * 上游导航启动日志为双模式（全程/分段），切换阈值未公开；
 * 应用侧按点位规模界定——超过阈值的长路线走分段渲染，控制单次成线规模。
 */
export const SEGMENT_MODE_POINT_THRESHOLD = 200;

/** 路线数据 → 渲染模式（导航启动时决定）。 */
export function routeRenderModeForPoints(pointCount: number): RouteRenderMode {
  return pointCount > SEGMENT_MODE_POINT_THRESHOLD ? "segment" : "full";
}

let roadSignTexture: CanvasTexture | null = null;

/**
 * 路牌贴图（程序化自建素材：主绿牌面 + 白色下行箭头）。
 * 无 canvas 环境（SSR/测试）返回 null，调用方退化为纯色 sprite。
 */
function getRoadSignTexture(): Texture | null {
  if (roadSignTexture !== null) {
    return roadSignTexture;
  }
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    return null;
  }
  // 牌面：主绿圆角板 + 深绿描边。
  const radius = 16;
  ctx.beginPath();
  ctx.roundRect(8, 8, 112, 144, radius);
  ctx.fillStyle = "#0ff796";
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#0a8f58";
  ctx.stroke();
  // 白色下行箭头（沿路线方向引导）。
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(64, 40);
  ctx.lineTo(92, 76);
  ctx.lineTo(74, 76);
  ctx.lineTo(74, 120);
  ctx.lineTo(54, 120);
  ctx.lineTo(54, 76);
  ctx.lineTo(36, 76);
  ctx.closePath();
  ctx.fill();
  roadSignTexture = new CanvasTexture(canvas);
  return roadSignTexture;
}

/** 生成一块路牌 sprite（恒面向相机）。 */
function createRoadSignSprite(position: Vec3): Sprite {
  const texture = getRoadSignTexture();
  const material = new SpriteMaterial(texture !== null ? { map: texture } : { color: SIGN_COLOR });
  const sprite = new Sprite(material);
  sprite.scale.set(SIGN_WIDTH, SIGN_HEIGHT, 1);
  sprite.position.set(position.x, position.y + SIGN_Y_OFFSET, position.z);
  sprite.renderOrder = 6;
  return sprite;
}

/**
 * 3D 路线图层：选中路线的主线折线 + 起点/终点球标 + 途经标注路牌（billboard）。
 * 主线支持全程/分段两种渲染模式（导航启动时按路线数据决定）；
 * 分段模式下 setSegmentIndex 随跟跑进度推进可见窗口。
 * setRoute(null) 清空；图层随 SceneManager 生命周期管理。
 */
export class RouteLayer implements EngineLayer {
  readonly id = "route-line";
  readonly root = new Group();

  readonly #line: Line<BufferGeometry, LineBasicMaterial>;
  readonly #startMarker: Mesh<SphereGeometry, MeshBasicMaterial>;
  readonly #endMarker: Mesh<SphereGeometry, MeshBasicMaterial>;
  readonly #markerGroup = new Group();
  #markerSprites: Sprite[] = [];
  #pointCount = 0;
  #renderMode: RouteRenderMode = "full";
  #segmentIndex: number | null = null;

  constructor() {
    this.#line = new Line(
      new BufferGeometry(),
      new LineBasicMaterial({ color: ROUTE_LINE_COLOR, transparent: true, opacity: 0.95 }),
    );
    this.#line.visible = false;
    this.#startMarker = new Mesh(
      new SphereGeometry(1.1, 12, 10),
      new MeshBasicMaterial({ color: START_COLOR }),
    );
    this.#startMarker.visible = false;
    this.#endMarker = new Mesh(
      new SphereGeometry(1.1, 12, 10),
      new MeshBasicMaterial({ color: END_COLOR }),
    );
    this.#endMarker.visible = false;
    this.root.add(this.#line, this.#startMarker, this.#endMarker, this.#markerGroup);
    this.root.renderOrder = 5;
  }

  /** 当前渲染模式（只读视图）。 */
  get renderMode(): RouteRenderMode {
    return this.#renderMode;
  }

  /** 显示路线（点位序列 + 标注点世界坐标）；null 清空。renderMode 决定主线绘制方式。 */
  setRoute(
    points: readonly Vec3[] | null,
    markers?: readonly Vec3[],
    options: { readonly renderMode?: RouteRenderMode } = {},
  ): void {
    for (const sprite of this.#markerSprites) {
      this.#markerGroup.remove(sprite);
      sprite.material.dispose();
    }
    this.#markerSprites = [];
    this.#renderMode = options.renderMode ?? "full";
    // 分段模式启动即前窗（路线起点起算）；全程模式无窗口。
    this.#segmentIndex = this.#renderMode === "segment" ? 0 : null;
    if (points === null || points.length < 2) {
      this.#pointCount = 0;
      this.#line.visible = false;
      this.#startMarker.visible = false;
      this.#endMarker.visible = false;
      return;
    }
    this.#pointCount = points.length;
    const positions = new Float32Array(points.length * 3);
    points.forEach((p, i) => {
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y + ROUTE_Y_OFFSET;
      positions[i * 3 + 2] = p.z;
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    this.#line.geometry.dispose();
    this.#line.geometry = geometry;
    this.#line.visible = true;

    const first = points[0];
    const last = points[points.length - 1];
    this.#startMarker.position.set(first.x, first.y + ROUTE_Y_OFFSET, first.z);
    this.#startMarker.visible = true;
    this.#endMarker.position.set(last.x, last.y + ROUTE_Y_OFFSET, last.z);
    this.#endMarker.visible = true;

    for (const marker of markers ?? []) {
      const sprite = createRoadSignSprite(marker);
      this.#markerGroup.add(sprite);
      this.#markerSprites.push(sprite);
    }
    this.#applyDrawRange();
  }

  /**
   * 分段渲染进度：index 为当前跟跑点位下标，可见窗口随之推进；
   * null 恢复全程绘制。全程模式下为 no-op。
   */
  setSegmentIndex(index: number | null): void {
    if (this.#renderMode !== "segment") {
      return;
    }
    this.#segmentIndex = index;
    this.#applyDrawRange();
  }

  /** 按渲染模式应用主线绘制范围。 */
  #applyDrawRange(): void {
    if (this.#pointCount === 0) {
      return;
    }
    if (this.#renderMode === "full" || this.#segmentIndex === null) {
      this.#line.geometry.setDrawRange(0, this.#pointCount);
      return;
    }
    const start = Math.max(0, this.#segmentIndex - SEGMENT_TRAIL_POINTS);
    const end = Math.min(this.#pointCount, this.#segmentIndex + SEGMENT_WINDOW_POINTS);
    this.#line.geometry.setDrawRange(start, end - start);
  }

  dispose(): void {
    this.#line.geometry.dispose();
    this.#line.material.dispose();
    this.#startMarker.geometry.dispose();
    this.#startMarker.material.dispose();
    this.#endMarker.geometry.dispose();
    this.#endMarker.material.dispose();
    this.setRoute(null);
    this.root.clear();
  }
}

import { BufferAttribute, BufferGeometry, Group, Line, LineBasicMaterial } from "three";
import type { EngineLayer } from "./SceneManager";
import type { InteractorsDoc } from "@/data/routes";
import type { Vec3 } from "@/common/geometry";

/**
 * F 键交互物件图层与近旁查询。
 *
 * - 3D 呈现：梯子/绳索/滑索各为一条线段（色值按工具色板：梯子=提示黄 #FFDA74、
 *   绳索=内容灰 #B5B7B8、滑索=链接蓝 #00AEFF）；近旁高亮提升不透明度。
 * - 近旁查询：nearestInteractor 以给定点求最近交互物件与距离（交互提示与 F 键判定共用）。
 *   滑索阈值取数据内 interactionRadius（实测 1.5 米）；梯子/绳索无数据半径，
 *   沿用统一默认提示半径（引擎默认 3 米）。
 */

const LADDER_COLOR = 0xffda74;
const ROPE_COLOR = 0xb5b7b8;
const ZIPLINE_COLOR = 0x00aeff;

/** 梯子/绳索的默认交互提示半径（米；源数据未携带半径字段）。 */
export const DEFAULT_INTERACT_RADIUS = 3;

/** 交互物件类型（决定 F 键行为与提示文案）。 */
export type InteractorKind = "ladder" | "rope" | "zipline";

/** 近旁查询结果。 */
export interface NearbyInteractor {
  readonly kind: InteractorKind;
  readonly index: number;
  /** 交互触发点（梯子=底端、绳索=近端、滑索=近端）。 */
  readonly point: Vec3;
  /** 触发点到查询点的距离（米）。 */
  readonly distance: number;
  /** 提示显示阈值（米）。 */
  readonly radius: number;
  /** F 键动作参数：梯子=顶端、绳索=对端、滑索=滑行终点。 */
  readonly target: Vec3;
  /** 滑索滑行速度（其余类型无意义）。 */
  readonly slideSpeed: number;
}

interface Segment {
  readonly kind: InteractorKind;
  readonly index: number;
  readonly from: Vec3;
  readonly to: Vec3;
  readonly radius: number;
  readonly slideSpeed: number;
  readonly line: Line<BufferGeometry, LineBasicMaterial>;
}

function distanceOf(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function makeSegmentLine(
  from: Vec3,
  to: Vec3,
  color: number,
): Line<BufferGeometry, LineBasicMaterial> {
  const positions = new Float32Array(6);
  positions[0] = from.x;
  positions[1] = from.y;
  positions[2] = from.z;
  positions[3] = to.x;
  positions[4] = to.y;
  positions[5] = to.z;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  const material = new LineBasicMaterial({ color, transparent: true, opacity: 0.55 });
  return new Line(geometry, material);
}

export class InteractorLayer implements EngineLayer {
  readonly id = "interactors";
  readonly root = new Group();

  #segments: Segment[] = [];
  #highlight: Segment | null = null;

  /** 载入一张地图的交互物件；null 清空。 */
  setInteractors(doc: InteractorsDoc | null): void {
    for (const segment of this.#segments) {
      this.root.remove(segment.line);
      segment.line.geometry.dispose();
      segment.line.material.dispose();
    }
    this.#segments = [];
    this.#highlight = null;
    if (doc === null) {
      return;
    }
    doc.ladders.forEach((ladder, index) => {
      this.#addSegment(
        "ladder",
        index,
        ladder.bottom,
        ladder.top,
        DEFAULT_INTERACT_RADIUS,
        0,
        LADDER_COLOR,
      );
    });
    doc.ropes.forEach((rope, index) => {
      this.#addSegment(
        "rope",
        index,
        rope.bottom,
        rope.top,
        DEFAULT_INTERACT_RADIUS,
        0,
        ROPE_COLOR,
      );
    });
    doc.ziplines.forEach((zipline, index) => {
      this.#addSegment(
        "zipline",
        index,
        zipline.a,
        zipline.b,
        Math.max(zipline.interactionRadius, DEFAULT_INTERACT_RADIUS),
        zipline.slideSpeed,
        ZIPLINE_COLOR,
      );
    });
  }

  #addSegment(
    kind: InteractorKind,
    index: number,
    from: Vec3,
    to: Vec3,
    radius: number,
    slideSpeed: number,
    color: number,
  ): void {
    const line = makeSegmentLine(from, to, color);
    const segment: Segment = { kind, index, from, to, radius, slideSpeed, line };
    this.#segments.push(segment);
    this.root.add(line);
  }

  /** 求最近交互物件（按交互触发点距离）；无数据返回 null。 */
  nearestInteractor(position: Vec3): NearbyInteractor | null {
    let best: NearbyInteractor | null = null;
    for (const segment of this.#segments) {
      const candidates: readonly { point: Vec3; target: Vec3 }[] = [
        { point: segment.from, target: segment.to },
        { point: segment.to, target: segment.from },
      ];
      for (const candidate of candidates) {
        const distance = distanceOf(position, candidate.point);
        if (best === null || distance < best.distance) {
          best = {
            kind: segment.kind,
            index: segment.index,
            point: candidate.point,
            distance,
            radius: segment.radius,
            target: candidate.target,
            slideSpeed: segment.slideSpeed,
          };
        }
      }
    }
    return best;
  }

  /** 高亮近旁物件（提示态）；null 清除高亮。 */
  setHighlight(nearby: NearbyInteractor | null): void {
    if (this.#highlight !== null) {
      this.#highlight.line.material.opacity = 0.55;
    }
    this.#highlight = null;
    if (nearby === null) {
      return;
    }
    const segment = this.#segments.find(
      (entry) => entry.kind === nearby.kind && entry.index === nearby.index,
    );
    if (segment !== undefined) {
      segment.line.material.opacity = 1;
      this.#highlight = segment;
    }
  }

  dispose(): void {
    this.setInteractors(null);
    this.root.clear();
  }
}

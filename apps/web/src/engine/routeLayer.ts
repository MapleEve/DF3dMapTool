import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
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
/** 标注点标记（楼层/提示黄 #FFDA74）。 */
const MARKER_COLOR = 0xffda74;

/**
 * 3D 路线图层：选中路线的主线折线 + 起点/终点球标 + 标注点球标。
 * setRoute(null) 清空；图层随 SceneManager 生命周期管理。
 */
export class RouteLayer implements EngineLayer {
  readonly id = "route-line";
  readonly root = new Group();

  readonly #line: Line<BufferGeometry, LineBasicMaterial>;
  readonly #startMarker: Mesh<SphereGeometry, MeshBasicMaterial>;
  readonly #endMarker: Mesh<SphereGeometry, MeshBasicMaterial>;
  readonly #markerGroup = new Group();
  #markerMeshes: Mesh<SphereGeometry, MeshBasicMaterial>[] = [];

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

  /** 显示路线（点位序列 + 标注点世界坐标）；null 清空。 */
  setRoute(points: readonly Vec3[] | null, markers?: readonly Vec3[]): void {
    this.#markerMeshes.forEach((mesh) => {
      this.#markerGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
    this.#markerMeshes = [];
    if (points === null || points.length < 2) {
      this.#line.visible = false;
      this.#startMarker.visible = false;
      this.#endMarker.visible = false;
      return;
    }
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
      const mesh = new Mesh(
        new SphereGeometry(0.9, 10, 8),
        new MeshBasicMaterial({ color: MARKER_COLOR }),
      );
      mesh.position.set(marker.x, marker.y + ROUTE_Y_OFFSET, marker.z);
      this.#markerGroup.add(mesh);
      this.#markerMeshes.push(mesh);
    }
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

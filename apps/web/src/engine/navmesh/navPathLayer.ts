import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
} from 'three';
import type { EngineLayer } from '../SceneManager';
import type { Vec3 } from '@/common/geometry';

/** 路径线上抬高度，避免与地面 z-fighting。 */
const PATH_Y_OFFSET = 0.35;

const PATH_COLOR = 0x36d399;
const START_COLOR = 0x8fd7ff;
const GOAL_COLOR = 0xffc65c;

/**
 * 3D 寻路路径图层：途经点折线 + 起点/终点标记。
 * setPath(null) 清空显示；图层本身随 SceneManager 生命周期管理。
 */
export class NavPathLayer implements EngineLayer {
  readonly id = 'nav-path';
  readonly root = new Group();

  readonly #line: Line<BufferGeometry, LineBasicMaterial>;
  readonly #startMarker: Mesh<SphereGeometry, MeshBasicMaterial>;
  readonly #goalMarker: Mesh<SphereGeometry, MeshBasicMaterial>;

  constructor() {
    this.#line = new Line(
      new BufferGeometry(),
      new LineBasicMaterial({ color: PATH_COLOR, transparent: true, opacity: 0.95 }),
    );
    this.#line.visible = false;
    this.#startMarker = new Mesh(
      new SphereGeometry(1.2, 12, 10),
      new MeshBasicMaterial({ color: START_COLOR }),
    );
    this.#startMarker.visible = false;
    this.#goalMarker = new Mesh(
      new SphereGeometry(1.2, 12, 10),
      new MeshBasicMaterial({ color: GOAL_COLOR }),
    );
    this.#goalMarker.visible = false;
    this.root.add(this.#line, this.#startMarker, this.#goalMarker);
    this.root.renderOrder = 5;
  }

  /** 显示路径；null 清空。 */
  setPath(points: readonly Vec3[] | null): void {
    if (points === null || points.length < 2) {
      this.#line.visible = false;
      this.#startMarker.visible = false;
      this.#goalMarker.visible = false;
      return;
    }
    const positions = new Float32Array(points.length * 3);
    points.forEach((p, i) => {
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y + PATH_Y_OFFSET;
      positions[i * 3 + 2] = p.z;
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    this.#line.geometry.dispose();
    this.#line.geometry = geometry;
    this.#line.visible = true;

    const first = points[0];
    const last = points[points.length - 1];
    this.#startMarker.position.set(first.x, first.y + PATH_Y_OFFSET, first.z);
    this.#startMarker.visible = true;
    this.#goalMarker.position.set(last.x, last.y + PATH_Y_OFFSET, last.z);
    this.#goalMarker.visible = true;
  }

  dispose(): void {
    this.#line.geometry.dispose();
    this.#line.material.dispose();
    this.#startMarker.geometry.dispose();
    this.#startMarker.material.dispose();
    this.#goalMarker.geometry.dispose();
    this.#goalMarker.material.dispose();
    this.root.clear();
  }
}

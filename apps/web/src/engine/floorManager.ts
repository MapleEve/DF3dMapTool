import { Group, type Material, type Object3D } from 'three';

/**
 * 楼层系统：按楼层分组管理场景对象，切层即组显隐。
 *
 * - 当前楼层组可见，其余组隐藏（或按淡化模式整体降不透明度，
 *   对齐"非当前楼层淡化"交互）；
 * - 楼层归属由地图图层在加载 chunk 时按实例高度分带判定后注册；
 * - 楼层列表与当前层通过状态对接（见 floorBinding），本类只管场景侧。
 */
export interface FloorManagerOptions {
  /** 非当前楼层淡化而非隐藏。 */
  readonly dimInactive?: boolean;
  /** 淡化不透明度（0-1）。 */
  readonly dimOpacity?: number;
}

const DEFAULT_DIM_OPACITY = 0.15;

interface FloorEntry {
  readonly group: Group;
  materials: Set<Material>;
}

export class FloorManager {
  readonly root: Group;
  readonly #options: Required<FloorManagerOptions>;
  readonly #entries = new Map<number, FloorEntry>();
  #availableFloors: readonly number[] = [];
  #activeFloor = 0;

  constructor(options: FloorManagerOptions = {}) {
    this.#options = {
      dimInactive: options.dimInactive ?? false,
      dimOpacity: options.dimOpacity ?? DEFAULT_DIM_OPACITY,
    };
    this.root = new Group();
    this.root.name = 'floors';
  }

  get availableFloors(): readonly number[] {
    return this.#availableFloors;
  }

  get activeFloor(): number {
    return this.#activeFloor;
  }

  /** 设置可用楼层（升序）；切换当前层到列表中的默认值。 */
  setAvailableFloors(floors: readonly number[], activeFloor?: number): void {
    this.#availableFloors = [...floors].sort((a, b) => a - b);
    this.setActiveFloor(activeFloor ?? this.#availableFloors[0] ?? 0);
  }

  /** 切层：当前层组可见，其余组隐藏或淡化。 */
  setActiveFloor(floor: number): void {
    this.#activeFloor = floor;
    for (const [entryFloor, entry] of this.#entries) {
      const active = entryFloor === floor;
      entry.group.visible = this.#options.dimInactive ? true : active;
      if (this.#options.dimInactive) {
        this.#applyOpacity(entry, active ? 1 : this.#options.dimOpacity);
      }
    }
  }

  /**
   * 注册对象到楼层组；对象所有权移交给 FloorManager（clear/dispose 时释放）。
   * 混合楼层的 chunk 内容应拆分后按层注册（见 splitInstancedMeshByFloor）。
   */
  register(object: Object3D, floor: number): void {
    let entry = this.#entries.get(floor);
    if (entry === undefined) {
      const group = new Group();
      group.name = `floor-${floor}`;
      entry = { group, materials: new Set() };
      this.#entries.set(floor, entry);
      this.root.add(group);
    }
    entry.group.add(object);
    object.traverse((node) => {
      const mesh = node as { material?: Material | Material[] };
      if (Array.isArray(mesh.material)) {
        for (const material of mesh.material) {
          entry.materials.add(material);
        }
      } else if (mesh.material) {
        entry.materials.add(mesh.material);
      }
    });
    this.setActiveFloor(this.#activeFloor);
  }

  /**
   * 从楼层组移除对象（chunk 卸载时调用）；同步回收其材质引用，
   * 返回是否确实属于该楼层组。
   */
  unregister(object: Object3D, floor: number): boolean {
    const entry = this.#entries.get(floor);
    if (entry === undefined || !object.parent) {
      return false;
    }
    let removed = false;
    object.traverse((node) => {
      const mesh = node as { material?: Material | Material[] };
      const drop = (material: Material): void => {
        if (entry.materials.delete(material)) {
          removed = true;
        }
      };
      if (Array.isArray(mesh.material)) {
        for (const material of mesh.material) {
          drop(material);
        }
      } else if (mesh.material) {
        drop(mesh.material);
      }
    });
    if (object.parent !== entry.group) {
      return removed;
    }
    entry.group.remove(object);
    return true;
  }

  /** 清空全部楼层组（换图时调用），不释放 GPU 资源（由调用方先 dispose 对象）。 */
  clear(): void {
    for (const entry of this.#entries.values()) {
      entry.group.clear();
    }
    this.#entries.clear();
    this.root.clear();
    this.#activeFloor = 0;
    this.#availableFloors = [];
  }

  #applyOpacity(entry: FloorEntry, opacity: number): void {
    for (const material of entry.materials) {
      material.opacity = opacity;
      material.transparent = opacity < 1;
      material.needsUpdate = opacity < 1;
    }
  }
}

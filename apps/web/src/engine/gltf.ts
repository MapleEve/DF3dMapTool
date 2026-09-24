import { type BufferGeometry, InstancedMesh, type Material, type Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACO_GLTF_CONFIG, DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import type { FloorBand } from "./floorBands";
import { floorForY } from "./floorBands";

/**
 * chunk GLB 解析器：GLTFLoader + Draco 解码器。
 *
 * 数据包内的 chunk GLB 使用网格压缩与 GPU 实例化扩展，
 * three 的 GLTFLoader 原生支持两者。Draco 原生解码器由 three 以
 * 模块相对 URL 自带（DRACO_GLTF_CONFIG），Vite 构建时改写为本地
 * 静态资产，离线可用，无需自备解码器文件。
 */
export class ChunkGltfParser {
  readonly #gltfLoader: GLTFLoader;
  readonly #dracoLoader: DRACOLoader;

  constructor(decoder: string | typeof DRACO_GLTF_CONFIG = DRACO_GLTF_CONFIG) {
    this.#dracoLoader = new DRACOLoader();
    this.#dracoLoader.setDecoderPath(decoder);
    this.#gltfLoader = new GLTFLoader();
    this.#gltfLoader.setDRACOLoader(this.#dracoLoader);
  }

  /** 解析 GLB 字节为场景对象（promise 化，失败时附带头部诊断信息）。 */
  parseGlb(bytes: Uint8Array): Promise<Object3D> {
    const arrayBuffer = toArrayBuffer(bytes);
    return new Promise<Object3D>((resolve, reject) => {
      this.#gltfLoader.parse(
        arrayBuffer,
        "",
        (gltf) => {
          resolve(gltf.scene);
        },
        (error) => {
          reject(
            new Error(`GLB 解析失败: ${error instanceof Error ? error.message : String(error)}`),
          );
        },
      );
    });
  }

  dispose(): void {
    this.#dracoLoader.dispose();
  }
}

/**
 * 释放一个对象子树的 GPU 资源：几何体、材质、实例属性。
 * 材质可能被同子树多个网格共享，先去重再逐个释放。
 */
export function disposeObject3D(root: Object3D): void {
  const materials = new Set<Material>();
  root.traverse((object) => {
    const mesh = object as InstancedMesh;
    if (mesh.isInstancedMesh) {
      mesh.dispose();
    }
    const geometry = (object as { geometry?: BufferGeometry }).geometry;
    if (geometry) {
      geometry.dispose();
    }
    const material = (object as { material?: Material | Material[] }).material;
    if (Array.isArray(material)) {
      for (const item of material) {
        materials.add(item);
      }
    } else if (material) {
      materials.add(material);
    }
  });
  for (const material of materials) {
    material.dispose();
  }
}

export interface FloorSplitPart {
  readonly floor: number;
  readonly mesh: InstancedMesh;
}

/**
 * 按楼层拆分实例化网格：逐实例取平移分量的 Y，经分带判定归属。
 * 全部实例同层时原样返回（免拷贝）；混合楼层时按层克隆出
 * 共享几何/材质的子 InstancedMesh。
 */
export function splitInstancedMeshByFloor(
  mesh: InstancedMesh,
  bands: readonly FloorBand[],
): FloorSplitPart[] {
  const matrices = mesh.instanceMatrix.array as ArrayLike<number>;
  const instanceCount = mesh.count;
  const buckets = new Map<number, number[]>();
  for (let index = 0; index < instanceCount; index += 1) {
    // 实例矩阵为列主序，平移分量在 12/13/14
    const y = matrices[index * 16 + 13];
    const floor = floorForY(bands, y);
    const list = buckets.get(floor);
    if (list === undefined) {
      buckets.set(floor, [index]);
    } else {
      list.push(index);
    }
  }

  if (buckets.size <= 1) {
    const only = buckets.keys().next();
    return [{ floor: only.done ? 0 : only.value, mesh }];
  }

  const parts: FloorSplitPart[] = [];
  for (const [floor, indices] of buckets) {
    const part = new InstancedMesh(mesh.geometry, mesh.material, indices.length);
    const targetArray = part.instanceMatrix.array;
    for (let target = 0; target < indices.length; target += 1) {
      const source = indices[target];
      for (let element = 0; element < 16; element += 1) {
        targetArray[target * 16 + element] = matrices[source * 16 + element];
      }
    }
    part.instanceMatrix.needsUpdate = true;
    part.userData = { ...mesh.userData };
    part.computeBoundingSphere();
    parts.push({ floor, mesh: part });
  }
  return parts;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

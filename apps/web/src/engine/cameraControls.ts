import { MathUtils, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PerspectiveCamera } from 'three';
import type { Vec3 } from '@/common/geometry';

const clamp = MathUtils.clamp;

/**
 * 轨道相机控制（对齐相机交互条目的参数行为）：
 *
 * - 旋转/缩放/平移限制：俯仰角限制（不钻地、不顶视翻转）、缩放距离限制；
 * - 地面碰撞下限：相机高度与注视点高度都不低于场景包围盒下沿的安全余量；
 * - 阻尼惯性：enableDamping + dampingFactor，帧循环中调用 update()；
 * - FOV 可调（对齐视场角设置项，带范围钳制；设置界面在 M2 接入）；
 * - 视角灵敏度可调（对齐灵敏度设置项；设置界面在 M2 接入）；
 * - POI 搜索定位走 flyTo 缓动飞行，用户一有输入立即中断；
 *   2D 标记 → 3D 传送同样经 flyTo，按路线图在 M2 接线；
 * - 回出生点 respawn() 复位到进场取景位（设置入口在 M2 接入）。
 */
export interface CameraLimits {
  /** 场景世界包围盒（平移注视点约束在此范围内）。 */
  readonly bounds: { readonly min: Vec3; readonly max: Vec3 };
  /** 俯仰角（相对水平面的仰角）范围，度。 */
  readonly elevationRange: readonly [min: number, max: number];
  /** 视距（到注视点距离）范围。 */
  readonly distanceRange: readonly [min: number, max: number];
  /** FOV 范围与默认值，度。 */
  readonly fovRange: readonly [number, number];
  readonly defaultFov: number;
  /** 相机最低高度（世界系），防止贴地穿模。 */
  readonly minCameraHeight: number;
}

export interface CameraLimitsInput {
  readonly bounds: { readonly min: Vec3; readonly max: Vec3 };
  readonly elevationRange?: readonly [number, number];
  readonly distanceRange?: readonly [number, number];
  readonly fovRange?: readonly [number, number];
  readonly defaultFov?: number;
  readonly minCameraHeight?: number;
}

const DEFAULT_ELEVATION: readonly [number, number] = [8, 85];
const DEFAULT_DISTANCE: readonly [number, number] = [15, 1500];
const DEFAULT_FOV_RANGE: readonly [number, number] = [30, 100];
const DEFAULT_FOV = 70;
const GROUND_MARGIN = 2;

interface FlyAnimation {
  fromTarget: Vector3;
  toTarget: Vector3;
  fromPosition: Vector3;
  toPosition: Vector3;
  elapsed: number;
  duration: number;
  finish(completed: boolean): void;
}

export class MapCameraControls extends OrbitControls {
  readonly #limits: CameraLimits;
  readonly #spawnTarget = new Vector3();
  #spawnDistance = 200;
  #animation: FlyAnimation | null = null;

  constructor(camera: PerspectiveCamera, domElement: HTMLElement, limits: CameraLimitsInput) {
    super(camera, domElement);
    this.#limits = {
      bounds: limits.bounds,
      elevationRange: limits.elevationRange ?? DEFAULT_ELEVATION,
      distanceRange: limits.distanceRange ?? DEFAULT_DISTANCE,
      fovRange: limits.fovRange ?? DEFAULT_FOV_RANGE,
      defaultFov: limits.defaultFov ?? DEFAULT_FOV,
      minCameraHeight: limits.minCameraHeight ?? limits.bounds.min.y + GROUND_MARGIN,
    };

    // 俯仰角限制：仰角越大极角越小（极角自 +Y 轴起算）
    const [minElevation, maxElevation] = this.#limits.elevationRange;
    this.minPolarAngle = Math.PI / 2 - (maxElevation * Math.PI) / 180;
    this.maxPolarAngle = Math.PI / 2 - (minElevation * Math.PI) / 180;
    this.minDistance = this.#limits.distanceRange[0];
    this.maxDistance = this.#limits.distanceRange[1];

    // 阻尼惯性
    this.enableDamping = true;
    this.dampingFactor = 0.08;
    this.rotateSpeed = 0.9;
    this.panSpeed = 0.9;
    this.zoomSpeed = 1.0;
    this.screenSpacePanning = false;

    // 用户任何输入立即打断缓动飞行
    this.addEventListener('start', () => this.cancelFlyTo());
    this.setFov(this.#limits.defaultFov);
  }

  get perspectiveCamera(): PerspectiveCamera {
    return this.object as PerspectiveCamera;
  }

  get limits(): CameraLimits {
    return this.#limits;
  }

  /** FOV 设置（带范围钳制），立即生效。 */
  setFov(fov: number): void {
    const [min, max] = this.#limits.fovRange;
    this.perspectiveCamera.fov = clamp(fov, min, max);
    this.perspectiveCamera.updateProjectionMatrix();
  }

  get fov(): number {
    return this.perspectiveCamera.fov;
  }

  /** 视角灵敏度（对齐设置项，1 为默认手感）。 */
  setSensitivity(sensitivity: number): void {
    this.rotateSpeed = clamp(sensitivity, 0.1, 3);
  }

  /**
   * 缓动飞行到目标点；distance 缺省保持当前视距。
   * 用户输入（拖拽/滚轮）会立即打断，promise 以 false 收尾。
   */
  flyTo(target: Vec3, distance?: number, durationMs = 700): Promise<boolean> {
    this.cancelFlyTo();
    const fromTarget = this.target.clone();
    const fromPosition = this.perspectiveCamera.position.clone();
    const toTarget = new Vector3(target.x, target.y, target.z);
    const d = distance ?? fromPosition.distanceTo(fromTarget);
    // 保持当前方位角与俯仰，仅改视距与注视点
    const direction = fromPosition.clone().sub(fromTarget).normalize();
    const toPosition = toTarget.clone().add(direction.multiplyScalar(d));
    return new Promise<boolean>((resolve) => {
      this.#animation = {
        fromTarget,
        toTarget,
        fromPosition,
        toPosition,
        elapsed: 0,
        duration: Math.max(durationMs, 1) / 1000,
        finish: resolve,
      };
    });
  }

  cancelFlyTo(): void {
    const animation = this.#animation;
    if (animation) {
      this.#animation = null;
      animation.finish(false);
    }
  }

  get flying(): boolean {
    return this.#animation !== null;
  }

  /** 回出生点：复位到进场取景位。 */
  respawn(): void {
    void this.flyTo(this.#spawnTarget, this.#spawnDistance, 500);
  }

  /** 以场景包围盒取景：设置进场注视点/视距与出生点位。 */
  frameBounds(bounds: { readonly min: Vec3; readonly max: Vec3 }): void {
    const center = new Vector3(
      (bounds.min.x + bounds.max.x) / 2,
      (bounds.min.y + bounds.max.y) / 2,
      (bounds.min.z + bounds.max.z) / 2,
    );
    const radius = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) / 2;
    const distance = clamp(radius * 1.9, this.minDistance, this.maxDistance);
    // 进场视角：东南 45° 方位、仰角取限制区间中值
    const [minElevation, maxElevation] = this.#limits.elevationRange;
    const elevation = (((minElevation + maxElevation) / 2) * Math.PI) / 180;
    const horizontal = Math.cos(elevation) * distance;
    this.target.copy(center);
    this.perspectiveCamera.position.set(
      center.x + horizontal * Math.SQRT1_2,
      Math.max(center.y + Math.sin(elevation) * distance, this.#limits.minCameraHeight),
      center.z + horizontal * Math.SQRT1_2,
    );
    this.perspectiveCamera.lookAt(center);
    this.#spawnTarget.copy(center);
    this.#spawnDistance = distance;
    this.update();
  }

  override update(deltaTime?: number | null): boolean {
    // OrbitControls 基类构造函数末尾会调用一次 this.update()（three r186），
    // 此时子类私有字段尚未初始化；用私有字段品牌检查保证首调安全。
    if (#animation in this) {
      const animation = this.#animation;
      if (animation) {
        animation.elapsed += deltaTime ?? 1 / 60;
        const t = clamp(animation.elapsed / animation.duration, 0, 1);
        const eased = easeInOutCubic(t);
        this.target.lerpVectors(animation.fromTarget, animation.toTarget, eased);
        this.perspectiveCamera.position.lerpVectors(
          animation.fromPosition,
          animation.toPosition,
          eased,
        );
        if (t >= 1) {
          this.#animation = null;
          animation.finish(true);
        }
      }
    }
    const changed = super.update(deltaTime);
    // 私有方法在 super() 返回前同样未安装品牌，调用点一并保护。
    if (#limits in this) {
      this.#clampToWorld();
    }
    return changed;
  }

  /** 平移注视点钳制在场景范围内；相机与注视点同步平移以保持视线几何。 */
  #clampToWorld(): void {
    const { bounds } = this.#limits;
    const clampedX = clamp(this.target.x, bounds.min.x, bounds.max.x);
    const clampedY = clamp(this.target.y, bounds.min.y, bounds.max.y);
    const clampedZ = clamp(this.target.z, bounds.min.z, bounds.max.z);
    const dx = clampedX - this.target.x;
    const dy = clampedY - this.target.y;
    const dz = clampedZ - this.target.z;
    if (dx !== 0 || dy !== 0 || dz !== 0) {
      this.target.set(clampedX, clampedY, clampedZ);
      this.perspectiveCamera.position.x += dx;
      this.perspectiveCamera.position.y += dy;
      this.perspectiveCamera.position.z += dz;
    }
    // 地面碰撞下限：相机不得低于场景下沿安全余量
    if (this.perspectiveCamera.position.y < this.#limits.minCameraHeight) {
      this.perspectiveCamera.position.y = this.#limits.minCameraHeight;
    }
  }
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

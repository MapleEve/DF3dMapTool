import {
  Clock,
  Color,
  Fog,
  HemisphereLight,
  type Light,
  type Object3D,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";

/** 场景中的一层内容（楼层组、标注层、地面等），由 SceneManager 统一调度生命周期。 */
export interface EngineLayer {
  readonly id: string;
  /** 加入场景的根对象（组/网格/灯光）。 */
  readonly root: Object3D;
  /** 每帧回调，deltaSeconds 为帧间隔。 */
  update?(deltaSeconds: number): void;
  /** 从场景移除并释放自身资源。 */
  dispose(): void;
}

export interface SceneManagerOptions {
  readonly fov?: number;
  readonly near?: number;
  readonly far?: number;
  readonly maxDevicePixelRatio?: number;
  /** 抗锯齿（渲染器创建参数，创建后不可变更，需重建视口）。 */
  readonly antialias?: boolean;
  /** 帧率上限（fps）；null 跟随显示器刷新率。 */
  readonly frameLimit?: number | null;
}

const DEFAULT_OPTIONS: Required<Omit<SceneManagerOptions, "frameLimit">> & {
  frameLimit: number | null;
} = {
  fov: 70,
  near: 0.5,
  far: 6000,
  maxDevicePixelRatio: 2,
  antialias: true,
  frameLimit: null,
};

/** 背景与雾同色：远处 chunk 渐隐入背景，掩盖流式加载的边缘。 */
const SKY_COLOR = 0x0b0f14;

/**
 * three.js 场景管理器骨架：持有 renderer/scene/camera 与渲染循环，
 * 图层（EngineLayer）按 id 注册，换图时逐层 dispose 后重建。
 */
export class SceneManager {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;

  readonly #canvas: HTMLCanvasElement;
  readonly #options: Required<Omit<SceneManagerOptions, "frameLimit">> & {
    frameLimit: number | null;
  };
  readonly #layers: EngineLayer[] = [];
  readonly #clock = new Clock();
  readonly #baseLighting: Light;

  #frameHandle = 0;
  #resizeObserver: ResizeObserver | null = null;
  #running = false;
  /** 帧率上限生效时累计到下一帧的时间（秒）。 */
  #frameBudget = 0;

  constructor(canvas: HTMLCanvasElement, options: SceneManagerOptions = {}) {
    this.#canvas = canvas;
    this.#options = { ...DEFAULT_OPTIONS, ...options };

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: this.#options.antialias,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, this.#options.maxDevicePixelRatio),
    );
    this.renderer.setClearColor(SKY_COLOR, 1);

    this.scene = new Scene();
    this.scene.background = new Color(SKY_COLOR);
    this.scene.fog = new Fog(SKY_COLOR, this.#options.far * 0.3, this.#options.far * 0.9);
    this.camera = new PerspectiveCamera(
      this.#options.fov,
      aspectOf(canvas) || 1,
      this.#options.near,
      this.#options.far,
    );
    this.camera.position.set(0, 80, 120);
    this.camera.lookAt(0, 0, 0);

    this.#baseLighting = new HemisphereLight(0xdfeaf5, 0x2a2f38, 1.1);
    this.scene.add(this.#baseLighting);

    this.#resizeObserver = new ResizeObserver(() => this.handleResize());
    if (canvas.parentElement) {
      this.#resizeObserver.observe(canvas.parentElement);
    }
    this.handleResize();

    this.start();
  }

  get layers(): readonly EngineLayer[] {
    return this.#layers;
  }

  /** 受管画布（相机控制/投影需要 DOM 尺寸与事件目标时使用）。 */
  get canvas(): HTMLCanvasElement {
    return this.#canvas;
  }

  /** 构建时的远平面（米）：渲染距离设置的复位基准。 */
  get defaultFar(): number {
    return this.#options.far;
  }

  /** 运行时调整雾范围（米；near 起淡、far 全隐）。 */
  setFogSpan(near: number, far: number): void {
    this.scene.fog = new Fog(SKY_COLOR, near, far);
  }

  addLayer(layer: EngineLayer): void {
    if (this.#layers.some((existing) => existing.id === layer.id)) {
      throw new RangeError(`图层 id 重复: ${layer.id}`);
    }
    this.#layers.push(layer);
    this.scene.add(layer.root);
  }

  removeLayer(id: string): void {
    const index = this.#layers.findIndex((layer) => layer.id === id);
    if (index < 0) {
      return;
    }
    const [layer] = this.#layers.splice(index, 1);
    this.scene.remove(layer.root);
    layer.dispose();
  }

  start(): void {
    if (this.#running) {
      return;
    }
    this.#running = true;
    this.#frameHandle = requestAnimationFrame(this.#tick);
  }

  stop(): void {
    if (!this.#running) {
      return;
    }
    this.#running = false;
    cancelAnimationFrame(this.#frameHandle);
  }

  /** 运行时调整帧率上限；null 恢复跟随显示器刷新率。 */
  setFrameLimit(fps: number | null): void {
    this.#options.frameLimit = fps;
    this.#frameBudget = 0;
  }

  handleResize(): void {
    const host = this.#canvas.parentElement;
    const width = host?.clientWidth ?? this.#canvas.clientWidth;
    const height = host?.clientHeight ?? this.#canvas.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.stop();
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    // 迭代中 removeLayer 会原地变更 #layers，需快照副本避免跳元素。
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const layer of [...this.#layers]) {
      this.removeLayer(layer.id);
    }
    this.scene.remove(this.#baseLighting);
    this.renderer.dispose();
  }

  #tick = (): void => {
    if (!this.#running) {
      return;
    }
    this.#frameHandle = requestAnimationFrame(this.#tick);
    const deltaSeconds = this.#clock.getDelta();
    // 帧率上限：预算不足时跳过渲染，图层步长仍按真实流逝时间推进
    const limit = this.#options.frameLimit;
    let step = deltaSeconds;
    if (limit !== null && limit > 0) {
      this.#frameBudget += deltaSeconds;
      const minFrame = 1 / limit;
      if (this.#frameBudget < minFrame * 0.98) {
        return;
      }
      step = Math.min(this.#frameBudget, 0.25);
      this.#frameBudget = 0;
    }
    for (const layer of this.#layers) {
      layer.update?.(step);
    }
    this.renderer.render(this.scene, this.camera);
  };
}

function aspectOf(canvas: HTMLCanvasElement): number {
  const width = canvas.parentElement?.clientWidth ?? canvas.clientWidth;
  const height = canvas.parentElement?.clientHeight ?? canvas.clientHeight;
  return height > 0 ? width / height : 1;
}

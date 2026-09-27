import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Points,
  PointsMaterial,
} from "three";
import type { EngineLayer } from "./SceneManager";
import type { Vec3 } from "@/common/geometry";

/**
 * 环境漂浮粒子层（「环境漂浮粒子」设置项的真实效果）。
 *
 * 轻量粒子系统：单 Points 网格 + 逐粒子漂移速度，环绕相机注视点
 * （焦点）活动盒内漂浮、越界环绕回盒内——相机移动时粒子群随焦点
 * 平移，视觉上始终在场景近旁漂浮。
 * - 每帧仅更新一个 Float32BufferAttribute（count × 3 浮点），开销极低；
 * - 半透明 + 加色混合 + 不写深度，避免与场景几何产生排序瑕疵。
 */

export interface MotesLayerOptions {
  /** 粒子数量（默认 360）。 */
  readonly count?: number;
  /** 活动盒半宽（米，x/z；默认 90）。 */
  readonly halfExtent?: number;
  /** 活动盒高度（米，y；默认 60，盒底为焦点下方 20 米）。 */
  readonly height?: number;
  /** 焦点提供器（相机注视点）；缺省/返回 null 时以世界原点为中心。 */
  readonly getFocus?: () => Vec3 | null;
}

const MOTES_LAYER_ID = "ambient-motes";

const randomBetween = (min: number, max: number): number => min + Math.random() * (max - min);

/** 偏差归一到区间 [-span/2, span/2)（x/z 轴环绕用；焦点瞬移任意远也能一帧回盒）。 */
const wrapSigned = (delta: number, span: number): number => {
  const half = span / 2;
  return ((((delta + half) % span) + span) % span) - half;
};

/** 偏差归一到区间 [0, span)（y 轴环绕用）。 */
const wrapUnsigned = (delta: number, span: number): number => {
  return ((delta % span) + span) % span;
};

/** 单粒子的漂移状态（位置在缓冲内就地更新）。 */
interface MoteMotion {
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  /** 垂直漂浮相位（正弦摆动的初相）。 */
  readonly phase: number;
  /** 垂直漂浮角速度（rad/s）。 */
  readonly bobSpeed: number;
}

export function createMotesLayer(options: MotesLayerOptions = {}): EngineLayer {
  const count = options.count ?? 360;
  const halfExtent = options.halfExtent ?? 90;
  const height = options.height ?? 60;
  const baseYOffset = -20;
  const getFocus = options.getFocus ?? (() => null);

  const positions = new Float32Array(count * 3);
  const motions: MoteMotion[] = [];

  // 初始布点以当前焦点为中心（首帧即有正确的粒子群位置，无需等 update 归位）。
  const initialFocus = getFocus();
  const initialCenterX = initialFocus?.x ?? 0;
  const initialCenterY = (initialFocus?.y ?? 0) + baseYOffset;
  const initialCenterZ = initialFocus?.z ?? 0;
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = initialCenterX + randomBetween(-halfExtent, halfExtent);
    positions[i * 3 + 1] = initialCenterY + randomBetween(0, height);
    positions[i * 3 + 2] = initialCenterZ + randomBetween(-halfExtent, halfExtent);
    motions.push({
      // 慢速水平漂移（±0.6 m/s）+ 极慢垂直漂移。
      vx: randomBetween(-0.6, 0.6),
      vy: randomBetween(-0.08, 0.08),
      vz: randomBetween(-0.6, 0.6),
      phase: randomBetween(0, Math.PI * 2),
      bobSpeed: randomBetween(0.2, 0.5),
    });
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const material = new PointsMaterial({
    color: 0xbfe8d2,
    // 粒径 1.5m：中近距浏览（~100-200m 视距）下呈 2-4px 漂浮微粒；
    // 总览视距（数百米）下为亚像素（世界尺度微粒的几何事实，不加屏幕空间补偿）。
    size: 1.5,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const points = new Points(geometry, material);
  // 位置缓冲按帧就地重写（环绕回相机注视点活动盒），THREE 缓存的包围球不会
  // 随之更新——初始布点若远离地图世界坐标（视口先建层后载图，焦点尚未就绪），
  // 整个 Points 网格会被视锥剔除为永不渲染。层本就环绕相机焦点（常在视域内），
  // 剔除无收益，直接关闭。
  points.frustumCulled = false;
  const root = new Group();
  root.add(points);

  let elapsed = 0;

  return {
    id: MOTES_LAYER_ID,
    root,
    update(deltaSeconds: number): void {
      elapsed += deltaSeconds;
      const focus = getFocus();
      const centerX = focus?.x ?? 0;
      const centerY = (focus?.y ?? 0) + baseYOffset;
      const centerZ = focus?.z ?? 0;
      const attribute = geometry.getAttribute("position") as Float32BufferAttribute;
      const array = attribute.array as Float32Array;
      for (let i = 0; i < count; i += 1) {
        const motion = motions[i];
        if (motion === undefined) {
          continue;
        }
        const base = i * 3;
        // 漂移 + 微幅正弦垂直摆动（叠加在慢速漂移之上）。
        array[base] += motion.vx * deltaSeconds;
        array[base + 1] +=
          (motion.vy + Math.sin(elapsed * motion.bobSpeed + motion.phase) * 0.35) * deltaSeconds;
        array[base + 2] += motion.vz * deltaSeconds;
        // 环绕回盒：超出活动盒（相对焦点）的粒子从对侧回到盒内。
        array[base] = centerX + wrapSigned(array[base] - centerX, halfExtent * 2);
        array[base + 1] = centerY + wrapUnsigned(array[base + 1] - centerY, height);
        array[base + 2] = centerZ + wrapSigned(array[base + 2] - centerZ, halfExtent * 2);
      }
      attribute.needsUpdate = true;
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}

export { MOTES_LAYER_ID };

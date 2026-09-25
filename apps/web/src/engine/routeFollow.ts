import type { Vec3 } from "@/common/geometry";

/**
 * 路线跟跑的纯计算层。
 *
 * 跟跑节奏 = 路线 durationSeconds（原始录制节奏）：点位按录制采样序均匀回放，
 * t ∈ [0,1] 映射到点索引 [0, n-1] 的线性插值。相机姿态 = 当前点位 + 眼高偏移，
 * 注视点 = 前视点（沿路线再往前 lookAheadT）。
 */

/** 跟跑视点抬升（米）：路线点位为角色足部高度，相机取眼部高度。 */
export const FOLLOW_EYE_HEIGHT = 1.7;
/** 前视时间窗（占全程比例）：注视点沿路线前移，产生自然的行进视角。 */
export const FOLLOW_LOOK_AHEAD_T = 0.02;
/** 入场混合时长（秒）：相机从当前位姿平滑接入跟跑位姿。 */
export const FOLLOW_BLEND_SECONDS = 0.6;

export function clampFollowT(t: number): number {
  if (!Number.isFinite(t)) {
    return 0;
  }
  return Math.min(1, Math.max(0, t));
}

/** t → 浮点点索引（[0, n-1]）。 */
export function followIndexAt(t: number, pointCount: number): number {
  if (pointCount <= 1) {
    return 0;
  }
  return clampFollowT(t) * (pointCount - 1);
}

function pointAt(points: Float32Array, indexFloat: number): Vec3 {
  const i = Math.floor(indexFloat);
  const frac = indexFloat - i;
  const base = i * 3;
  const x0 = points[base] ?? 0;
  const y0 = points[base + 1] ?? 0;
  const z0 = points[base + 2] ?? 0;
  if (frac <= 0 || base + 5 >= points.length) {
    return { x: x0, y: y0, z: z0 };
  }
  const x1 = points[base + 3];
  const y1 = points[base + 4];
  const z1 = points[base + 5];
  return {
    x: x0 + (x1 - x0) * frac,
    y: y0 + (y1 - y0) * frac,
    z: z0 + (z1 - z0) * frac,
  };
}

/** t 处的路线点位（管线世界系）。 */
export function followPositionAt(points: Float32Array, t: number): Vec3 {
  return pointAt(points, followIndexAt(t, points.length / 3));
}

/** t 处的行进方向（归一化；单点路线返回零向量）。 */
export function followHeadingAt(points: Float32Array, t: number): Vec3 {
  const count = points.length / 3;
  if (count < 2) {
    return { x: 0, y: 0, z: 0 };
  }
  const indexFloat = followIndexAt(t, count);
  const i = Math.min(Math.floor(indexFloat), count - 2);
  const ax = points[i * 3];
  const ay = points[i * 3 + 1];
  const az = points[i * 3 + 2];
  const bx = points[i * 3 + 3];
  const by = points[i * 3 + 4];
  const bz = points[i * 3 + 5];
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (length === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  return { x: dx / length, y: dy / length, z: dz / length };
}

/** 混合两个位姿（blend ∈ [0,1]，0 = from，1 = to）。 */
export function blendPose(
  from: { position: Vec3; target: Vec3 },
  to: { position: Vec3; target: Vec3 },
  blend: number,
): { position: Vec3; target: Vec3 } {
  const k = Math.min(1, Math.max(0, blend));
  const mix = (a: Vec3, b: Vec3): Vec3 => ({
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    z: a.z + (b.z - a.z) * k,
  });
  return { position: mix(from.position, to.position), target: mix(from.target, to.target) };
}

/** t 处的跟跑相机位姿（点位 + 眼高；注视点为前视点，同样抬升注视眼高）。 */
export function followPoseAt(
  points: Float32Array,
  t: number,
  eyeHeight: number,
  lookAheadT: number,
): { position: Vec3; target: Vec3 } {
  const position = followPositionAt(points, t);
  const ahead = followPositionAt(points, clampFollowT(t + lookAheadT));
  return {
    position: { x: position.x, y: position.y + eyeHeight, z: position.z },
    target: { x: ahead.x, y: ahead.y + eyeHeight, z: ahead.z },
  };
}

/**
 * 滑索滑行时长（秒）：A→B 直线距离 / 滑行速度（数据内 slideSpeed）。
 */
export function ziplineDurationSeconds(a: Vec3, b: Vec3, slideSpeed: number): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const speed = slideSpeed > 0 ? slideSpeed : 1;
  return distance / speed;
}

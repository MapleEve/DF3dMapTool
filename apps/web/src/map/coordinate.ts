import type { Euler3, Quaternion4, Vec3 } from "@/common/geometry";

/**
 * 世界坐标与旋转的统一变换规则（管线与运行时共用同一约定）：
 *
 * - 源欧拉角按 Y-X-Z 内旋顺序换算为四元数；
 * - 坐标系镜像（位置）：(x, y, z) → (x, y, −z)；
 * - 坐标系镜像（旋转）：(qx, qy, qz, qw) → (−qx, −qy, +qz, qw)。
 *
 * 纯 yaw 物件镜像后朝向等价（yaw 分量取反，与位置镜像配对自洽）；
 * 带横滚/俯仰的构件（坡道、梯子、管道）必须走该规则，
 * 否则会出现姿态错误。首张地图的端到端目检是 M1 验收项。
 *
 * 与管线侧（半角闭式公式）保持逐位一致：欧拉角任一分量可超过 ±180°
 * （实测摆放表存在 yaw 270.0001°、349.9999°、横滚 357.4115°），
 * 此时 cos(θ/2) 为负，必须保留符号，禁止用 sqrt 反推模长。
 * coordinate.test.ts 内置独立实现互验，防止两侧漂移。
 */

/** 源欧拉角的内旋顺序。 */
export const SOURCE_EULER_ORDER = "YXZ" as const;

function hamiltonMultiply(a: Quaternion4, b: Quaternion4): Quaternion4 {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/**
 * 单轴四元数。w 必须取 cos(θ/2) 的真实符号：
 * 角度超过 180° 时 cos(θ/2) 为负，用 sqrt(1−sin²) 之类「模长反推」会把
 * 270° 旋转变成 90°，实测摆放表中存在 yaw 270°/349.9°、横滚 357.4° 一类样本。
 */
function axisQuaternion(x: number, y: number, z: number, w: number): Quaternion4 {
  return { x, y, z, w };
}

/** 欧拉角（弧度，Y-X-Z 内旋）→ 四元数。等价于 q = qY ⊗ qX ⊗ qZ。 */
export function quaternionFromEulerYXZ(euler: Euler3): Quaternion4 {
  const halfX = euler.x / 2;
  const halfY = euler.y / 2;
  const halfZ = euler.z / 2;
  const qX = axisQuaternion(Math.sin(halfX), 0, 0, Math.cos(halfX));
  const qY = axisQuaternion(0, Math.sin(halfY), 0, Math.cos(halfY));
  const qZ = axisQuaternion(0, 0, Math.sin(halfZ), Math.cos(halfZ));
  return hamiltonMultiply(hamiltonMultiply(qY, qX), qZ);
}

/** Z 轴镜像下的四元数变换。 */
export function mirrorZQuaternion(quaternion: Quaternion4): Quaternion4 {
  return { x: -quaternion.x, y: -quaternion.y, z: quaternion.z, w: quaternion.w };
}

/** Z 轴镜像下的位置变换。 */
export function mirrorZPosition(position: Vec3): Vec3 {
  return { x: position.x, y: position.y, z: -position.z };
}

/** 度 → 弧度。 */
export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * 摆放对象全流程变换：源欧拉角（度）→ 四元数 → Z 镜像；源位置 → Z 镜像。
 * POI、路线、区域等所有输入数据统一走本函数，保证内部自洽。
 */
export function transformPlacement(
  position: Vec3,
  eulerDegrees: Euler3,
): { position: Vec3; rotation: Quaternion4 } {
  const rotation = mirrorZQuaternion(
    quaternionFromEulerYXZ({
      x: degreesToRadians(eulerDegrees.x),
      y: degreesToRadians(eulerDegrees.y),
      z: degreesToRadians(eulerDegrees.z),
    }),
  );
  return { position: mirrorZPosition(position), rotation };
}

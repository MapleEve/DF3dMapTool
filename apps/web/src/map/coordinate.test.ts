import { describe, expect, it } from 'vitest';
import {
  degreesToRadians,
  mirrorZPosition,
  mirrorZQuaternion,
  quaternionFromEulerYXZ,
  SOURCE_EULER_ORDER,
  transformPlacement,
} from './coordinate';

const EPSILON = 1e-9;

function expectClose(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThan(EPSILON);
}

/**
 * 管线侧同一规则的独立实现（半角闭式公式，与运行时侧的哈密顿乘积是两条不同推导路径）。
 * 资产管线定版：源欧拉角度按 Y-X-Z 内旋（q = qY ⊗ qX ⊗ qZ）→ 四元数 → Z 镜像。
 * 本测试以独立实现互验运行时实现，防止两侧漂移。
 */
function pipelineEulerYxzToQuatDegrees(
  rx: number,
  ry: number,
  rz: number,
): { x: number; y: number; z: number; w: number } {
  const ex = (rx * Math.PI) / 180 / 2;
  const ey = (ry * Math.PI) / 180 / 2;
  const ez = (rz * Math.PI) / 180 / 2;
  const cx = Math.cos(ex);
  const sx = Math.sin(ex);
  const cy = Math.cos(ey);
  const sy = Math.sin(ey);
  const cz = Math.cos(ez);
  const sz = Math.sin(ez);
  return {
    x: cy * sx * cz + sy * cx * sz,
    y: sy * cx * cz - cy * sx * sz,
    z: cy * cx * sz - sy * sx * cz,
    w: cy * cx * cz + sy * sx * sz,
  };
}

function pipelineMirrorQuaternion(quaternion: { x: number; y: number; z: number; w: number }) {
  const norm = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  const x = quaternion.x / norm;
  const y = quaternion.y / norm;
  const z = quaternion.z / norm;
  const w = quaternion.w / norm;
  return { x: -x, y: -y, z, w };
}

describe('坐标变换', () => {
  it('内旋顺序常量为 YXZ', () => {
    expect(SOURCE_EULER_ORDER).toBe('YXZ');
  });

  it('恒等欧拉角 → 单位四元数', () => {
    const quaternion = quaternionFromEulerYXZ({ x: 0, y: 0, z: 0 });
    expect(quaternion).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it('绕 Y 轴 90°：Y-X-Z 顺序下等价于纯 qY', () => {
    const quaternion = quaternionFromEulerYXZ({ x: 0, y: Math.PI / 2, z: 0 });
    expectClose(quaternion.y, Math.SQRT1_2);
    expectClose(quaternion.w, Math.SQRT1_2);
    expectClose(quaternion.x, 0);
    expectClose(quaternion.z, 0);
  });

  it('纯 yaw 物件经 Z 镜像后旋转不变（yaw 分量守恒）', () => {
    const quaternion = quaternionFromEulerYXZ({ x: 0, y: Math.PI / 3, z: 0 });
    const mirrored = mirrorZQuaternion(quaternion);
    expectClose(Math.abs(mirrored.y), Math.abs(quaternion.y));
    expectClose(Math.abs(mirrored.w), Math.abs(quaternion.w));
  });

  it('镜像规则：qx/qy 取反、qz/qw 保留', () => {
    const mirrored = mirrorZQuaternion({ x: 0.1, y: 0.2, z: 0.3, w: 0.9 });
    expect(mirrored).toEqual({ x: -0.1, y: -0.2, z: 0.3, w: 0.9 });
  });

  it('位置镜像：(x, y, z) → (x, y, −z)', () => {
    expect(mirrorZPosition({ x: 1, y: -2, z: 3 })).toEqual({ x: 1, y: -2, z: -3 });
    expect(mirrorZPosition(mirrorZPosition({ x: 5, y: 6, z: 7 }))).toEqual({ x: 5, y: 6, z: 7 });
  });

  it('transformPlacement 全流程（角度制输入）', () => {
    const { position, rotation } = transformPlacement(
      { x: 100, y: 20, z: -50 },
      { x: 0, y: 180, z: 0 },
    );
    expect(position).toEqual({ x: 100, y: 20, z: 50 });
    // 纯 yaw 经镜像后朝向等价：yaw 分量取反、w 分量保留
    expectClose(rotation.y, -Math.sin(degreesToRadians(90)));
    expectClose(rotation.w, Math.cos(degreesToRadians(90)));
  });

  it('复合姿态（pitch + roll）镜像不等于简单取反 yaw', () => {
    const euler = { x: Math.PI / 6, y: Math.PI / 4, z: Math.PI / 8 };
    const quaternion = quaternionFromEulerYXZ(euler);
    const mirrored = mirrorZQuaternion(quaternion);
    // 与直接取反 y 分量不同，验证走的是完整四元数镜像规则
    expect(mirrored).not.toEqual({ ...quaternion, y: -quaternion.y });
  });
});

describe('坐标变换：与管线侧独立实现互验', () => {
  /** 管线实测定版样本（az3 摆放表实测值域：yaw 为主、少量 pitch/roll 复合件）。 */
  const SAMPLES: ReadonlyArray<{ euler: { x: number; y: number; z: number } }> = [
    { euler: { x: 0, y: 0, z: 0 } },
    { euler: { x: -0, y: 0.0224, z: -0 } },
    { euler: { x: 0, y: 50, z: 0 } },
    { euler: { x: 0, y: 67.6046, z: 0 } },
    { euler: { x: 0, y: 270.0001, z: 0 } },
    { euler: { x: 0, y: 349.9999, z: 0 } },
    { euler: { x: 357.4115, y: 21.7385, z: 339.7721 } },
    { euler: { x: 45, y: 90, z: 45 } },
    { euler: { x: 90, y: 180, z: 270 } },
    { euler: { x: 30, y: -45, z: 60 } },
    { euler: { x: 179.9999, y: -179.9999, z: 89.9999 } },
  ];

  it('欧拉角→四元数与管线半角闭式公式一致（含随机样本）', () => {
    const samples = [
      ...SAMPLES,
      ...Array.from({ length: 64 }, (_, index) => ({
        euler: {
          x: ((index * 137.508) % 360) - 180,
          y: ((index * 91.31) % 360) - 180,
          z: ((index * 53.77) % 360) - 180,
        },
      })),
    ];
    for (const { euler } of samples) {
      const runtime = quaternionFromEulerYXZ({
        x: degreesToRadians(euler.x),
        y: degreesToRadians(euler.y),
        z: degreesToRadians(euler.z),
      });
      const pipeline = pipelineEulerYxzToQuatDegrees(euler.x, euler.y, euler.z);
      expectClose(runtime.x, pipeline.x);
      expectClose(runtime.y, pipeline.y);
      expectClose(runtime.z, pipeline.z);
      expectClose(runtime.w, pipeline.w);
    }
  });

  it('Z 镜像四元数与管线实现一致（运行时输入为单位四元数时无需再归一）', () => {
    for (const { euler } of SAMPLES) {
      const runtime = quaternionFromEulerYXZ({
        x: degreesToRadians(euler.x),
        y: degreesToRadians(euler.y),
        z: degreesToRadians(euler.z),
      });
      const mirrored = mirrorZQuaternion(runtime);
      const pipelineMirrored = pipelineMirrorQuaternion(runtime);
      // 运行时输入已是单位四元数，镜像不应改模长；管线实现带归一，两者应逐分量一致
      const norm = Math.hypot(mirrored.x, mirrored.y, mirrored.z, mirrored.w);
      expectClose(norm, 1);
      expectClose(mirrored.x, pipelineMirrored.x);
      expectClose(mirrored.y, pipelineMirrored.y);
      expectClose(mirrored.z, pipelineMirrored.z);
      expectClose(mirrored.w, pipelineMirrored.w);
    }
  });

  it('transformPlacement 与管线「位置镜像 + 四元数镜像」全流程一致', () => {
    for (const { euler } of SAMPLES) {
      const position = { x: -1720.2815, y: 0.3946, z: 2163.6277 };
      const { position: runtimePos, rotation: runtimeRot } = transformPlacement(position, euler);
      expectClose(runtimePos.x, position.x);
      expectClose(runtimePos.y, position.y);
      expectClose(runtimePos.z, -position.z);
      const pipeline = pipelineMirrorQuaternion(
        pipelineEulerYxzToQuatDegrees(euler.x, euler.y, euler.z),
      );
      expectClose(runtimeRot.x, pipeline.x);
      expectClose(runtimeRot.y, pipeline.y);
      expectClose(runtimeRot.z, pipeline.z);
      expectClose(runtimeRot.w, pipeline.w);
    }
  });
});

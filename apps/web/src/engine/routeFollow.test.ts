import { describe, expect, it } from "vitest";
import {
  FOLLOW_EYE_HEIGHT,
  blendPose,
  clampFollowT,
  followHeadingAt,
  followIndexAt,
  followPositionAt,
  followPoseAt,
  ziplineDurationSeconds,
} from "./routeFollow";

/** 构造点位序列（管线世界系 xyz float32）。 */
function pointsOf(values: readonly [number, number, number][]): Float32Array {
  const out = new Float32Array(values.length * 3);
  values.forEach((v, i) => {
    out[i * 3] = v[0];
    out[i * 3 + 1] = v[1];
    out[i * 3 + 2] = v[2];
  });
  return out;
}

describe("路线跟跑插值", () => {
  const points = pointsOf([
    [0, 0, 0],
    [10, 0, 0],
    [10, 0, -10],
  ]);

  it("clampFollowT 钳制到 [0,1]，非法值归零", () => {
    expect(clampFollowT(0.5)).toBe(0.5);
    expect(clampFollowT(-1)).toBe(0);
    expect(clampFollowT(2)).toBe(1);
    expect(clampFollowT(Number.NaN)).toBe(0);
  });

  it("followIndexAt 按点数归一（单点路线恒为 0）", () => {
    expect(followIndexAt(0, 3)).toBe(0);
    expect(followIndexAt(1, 3)).toBe(2);
    expect(followIndexAt(0.5, 3)).toBe(1);
    expect(followIndexAt(0.9, 1)).toBe(0);
  });

  it("followPositionAt 均匀按索引插值", () => {
    expect(followPositionAt(points, 0)).toEqual({ x: 0, y: 0, z: 0 });
    expect(followPositionAt(points, 0.25)).toEqual({ x: 5, y: 0, z: 0 });
    expect(followPositionAt(points, 0.5)).toEqual({ x: 10, y: 0, z: 0 });
    expect(followPositionAt(points, 0.75)).toEqual({ x: 10, y: 0, z: -5 });
    expect(followPositionAt(points, 1)).toEqual({ x: 10, y: 0, z: -10 });
  });

  it("followHeadingAt 给出归一化行进方向", () => {
    expect(followHeadingAt(points, 0.1)).toEqual({ x: 1, y: 0, z: 0 });
    expect(followHeadingAt(points, 0.6)).toEqual({ x: 0, y: 0, z: -1 });
    const single = pointsOf([[1, 2, 3]]);
    expect(followHeadingAt(single, 0)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("followPoseAt 抬升眼高并前视", () => {
    const pose = followPoseAt(points, 0.5, FOLLOW_EYE_HEIGHT, 0.25);
    expect(pose.position).toEqual({ x: 10, y: FOLLOW_EYE_HEIGHT, z: 0 });
    expect(pose.target).toEqual({ x: 10, y: FOLLOW_EYE_HEIGHT, z: -5 });
  });

  it("blendPose 在两位姿间线性混合", () => {
    const from = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };
    const to = { position: { x: 10, y: 10, z: 10 }, target: { x: 5, y: 5, z: 5 } };
    expect(blendPose(from, to, 0)).toEqual(from);
    expect(blendPose(from, to, 1)).toEqual(to);
    const mid = blendPose(from, to, 0.5);
    expect(mid.position).toEqual({ x: 5, y: 5, z: 5 });
    // 越界钳制
    expect(blendPose(from, to, 2)).toEqual(to);
  });

  it("ziplineDurationSeconds 按数据滑行速度换算", () => {
    expect(ziplineDurationSeconds({ x: 0, y: 0, z: 0 }, { x: 50, y: 0, z: 0 }, 5)).toBeCloseTo(
      10,
      6,
    );
    // 速度非正值回退 1 m/s，不产生无穷时长
    expect(ziplineDurationSeconds({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 0)).toBeCloseTo(
      10,
      6,
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  isInsideCalibration,
  pixelToWorld,
  pipelinePixelToWorld,
  pipelineWorldToPixel,
  toRegionDisplayCoords,
  worldToPixel,
  worldToPixelClamped,
  worldToUv,
} from "./project";
import type { BigmapCalibration } from "./types";

/**
 * 真实标定样例（量级与字段取自内置数据包的 2D 楼层标定）：
 * - 零号大坝式标定：世界盒 (3011.84, 7232.96) → (4109.07, 8134.24)，虚拟网格 4096²，
 *   区域「行政辖区」源世界坐标 (3645.988, 7877.95)；
 * - AZ3 式标定（管线世界系）：世界盒 x [-2761.50, -1423.98]、z [-2757.60, -1489.96]，
 *   POI 锚点 (-1657.2, -1859.3)，虚拟网格 4096²，可玩区 px {x:257, y:826, w:3370, h:3195}。
 */
const dbCalibration: BigmapCalibration = {
  worldMinX: 3011.84,
  worldMaxX: 4109.07,
  worldMinZ: 7232.96,
  worldMaxZ: 8134.24,
  imageWidthPx: 4096,
  imageHeightPx: 4096,
};

const az3Calibration: BigmapCalibration = {
  worldMinX: -2761.5009765625,
  worldMaxX: -1423.978515625,
  worldMinZ: -2757.5952,
  worldMaxZ: -1489.9634,
  imageWidthPx: 4096,
  imageHeightPx: 4096,
};

describe("2D 投影（源世界系口径）", () => {
  it("包围盒角点映射到底图四角，Z 轴向下翻转（v=0 对应 worldMaxZ）", () => {
    expect(worldToUv({ x: 3011.84, z: 8134.24 }, dbCalibration).u).toBeCloseTo(0, 9);
    expect(worldToUv({ x: 3011.84, z: 8134.24 }, dbCalibration).v).toBeCloseTo(0, 9);
    expect(worldToUv({ x: 4109.07, z: 7232.96 }, dbCalibration).u).toBeCloseTo(1, 9);
    expect(worldToUv({ x: 4109.07, z: 7232.96 }, dbCalibration).v).toBeCloseTo(1, 9);
    const topLeft = worldToPixel({ x: 3011.84, z: 8134.24 }, dbCalibration);
    expect(topLeft.x).toBeCloseTo(0, 6);
    expect(topLeft.y).toBeCloseTo(0, 6);
    const bottomRight = worldToPixel({ x: 4109.07, z: 7232.96 }, dbCalibration);
    expect(bottomRight.x).toBeCloseTo(4096, 6);
    expect(bottomRight.y).toBeCloseTo(4096, 6);
  });

  it("真实样例值：行政辖区 (3645.988, 7877.95) → 像素 (≈2367.3, ≈1165.1)", () => {
    const pixel = worldToPixel({ x: 3645.988, z: 7877.95 }, dbCalibration);
    expect(pixel.x).toBeCloseTo(2367.3, 0);
    expect(pixel.y).toBeCloseTo(1165.1, 0);
  });

  it("world → pixel → world 往返还原", () => {
    const world = { x: 3645.988, z: 7877.95 };
    const pixel = worldToPixel(world, dbCalibration);
    const back = pixelToWorld(pixel, dbCalibration);
    expect(back.x).toBeCloseTo(world.x, 6);
    expect(back.z).toBeCloseTo(world.z, 6);
  });

  it("区域显示坐标 = 世界 ×100、Z 取负", () => {
    const display = toRegionDisplayCoords({ x: 3789.162, z: 4597.274 });
    expect(display.x).toBeCloseTo(378916.2, 6);
    expect(display.y).toBeCloseTo(-459727.4, 6);
  });

  it("越界判定与夹取投影", () => {
    expect(isInsideCalibration({ x: 3011.84, z: 0 }, dbCalibration)).toBe(false);
    expect(isInsideCalibration({ x: 3500, z: 8000 }, dbCalibration)).toBe(true);
    const clamped = worldToPixelClamped({ x: 0, z: 9000 }, dbCalibration);
    expect(clamped.x).toBe(0);
    expect(clamped.y).toBe(0);
  });
});

describe("2D 投影（管线世界系口径）", () => {
  it("py 随管线 +z 增长：minZ 边在画面顶部、maxZ 边在底部", () => {
    const topLeft = pipelineWorldToPixel({ x: -2761.5009765625, z: -2757.5952 }, az3Calibration);
    expect(topLeft.x).toBeCloseTo(0, 6);
    expect(topLeft.y).toBeCloseTo(0, 6);
    const bottomRight = pipelineWorldToPixel({ x: -1423.978515625, z: -1489.9634 }, az3Calibration);
    expect(bottomRight.x).toBeCloseTo(4096, 6);
    expect(bottomRight.y).toBeCloseTo(4096, 6);
  });

  it("真实样例值：AZ3 POI 锚点 (-1657.2, -1859.3) → 像素 (≈3381.8, ≈2902.6)，落在可玩区内", () => {
    const pixel = pipelineWorldToPixel({ x: -1657.2, z: -1859.3 }, az3Calibration);
    expect(pixel.x).toBeCloseTo(3381.8, 0);
    expect(pixel.y).toBeCloseTo(2902.6, 0);
    // 可玩区矩形（虚拟网格坐标）。
    expect(pixel.x).toBeGreaterThanOrEqual(257);
    expect(pixel.x).toBeLessThanOrEqual(257 + 3370);
    expect(pixel.y).toBeGreaterThanOrEqual(826);
    expect(pixel.y).toBeLessThanOrEqual(826 + 3195);
  });

  it("pixel → world 逆变换往返还原", () => {
    const world = { x: -1657.2, z: -1859.3 };
    const pixel = pipelineWorldToPixel(world, az3Calibration);
    const back = pipelinePixelToWorld(pixel, az3Calibration);
    expect(back.x).toBeCloseTo(world.x, 6);
    expect(back.z).toBeCloseTo(world.z, 6);
  });

  it("两口径等价性：源世界点经 Z 镜像 + 标定盒同步镜像后，两公式给出同一像素", () => {
    // 源世界系标定（z 未镜像）与点 (3645.988, 7877.95)。
    const originalWorld = { x: 3645.988, z: 7877.95 };
    const mirroredWorld = { x: originalWorld.x, z: -originalWorld.z };
    const mirroredCalibration: BigmapCalibration = {
      ...dbCalibration,
      worldMinZ: -dbCalibration.worldMaxZ,
      worldMaxZ: -dbCalibration.worldMinZ,
    };
    const originalPixel = worldToPixel(originalWorld, dbCalibration);
    const pipelinePixel = pipelineWorldToPixel(mirroredWorld, mirroredCalibration);
    expect(pipelinePixel.x).toBeCloseTo(originalPixel.x, 9);
    expect(pipelinePixel.y).toBeCloseTo(originalPixel.y, 9);
  });
});

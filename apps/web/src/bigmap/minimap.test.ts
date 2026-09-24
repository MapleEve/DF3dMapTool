import { describe, expect, it } from "vitest";
import {
  MINIMAP_SPAN_FRACTION,
  minimapWindowUv,
  minimapWorldSpan,
  pipelineWorldDisplayCoords,
  worldToMinimapCanvas,
} from "./minimap";
import type { BigmapCalibration } from "./types";

/** AZ3 2D 楼层标定样例（管线世界系，同 project.test.ts）。 */
const az3Calibration: BigmapCalibration = {
  worldMinX: -2761.5009765625,
  worldMaxX: -1423.978515625,
  worldMinZ: -2757.5952,
  worldMaxZ: -1489.9634,
  imageWidthPx: 4096,
  imageHeightPx: 4096,
};

const SPAN = minimapWorldSpan(az3Calibration);

describe("HUD 小地图取景（GetMapImageRect 语义）", () => {
  it("视窗世界跨度 = 楼层包围盒较长边 × 固定比例", () => {
    const spanX = az3Calibration.worldMaxX - az3Calibration.worldMinX;
    const spanZ = az3Calibration.worldMaxZ - az3Calibration.worldMinZ;
    expect(SPAN).toBeCloseTo(Math.max(spanX, spanZ) * MINIMAP_SPAN_FRACTION, 9);
  });

  it("中心取景：玩家位于视窗中心，视窗不越出底图", () => {
    const center = { x: -2000, z: -2000 };
    const view = minimapWindowUv(center, az3Calibration, SPAN);
    expect(view.u1 > view.u0).toBe(true);
    expect(view.v1 > view.v0).toBe(true);
    expect(view.u0).toBeGreaterThanOrEqual(0);
    expect(view.v0).toBeGreaterThanOrEqual(0);
    expect(view.u1).toBeLessThanOrEqual(1);
    expect(view.v1).toBeLessThanOrEqual(1);

    // 玩家世界坐标映射到画布中心（172px 视窗）。
    const point = worldToMinimapCanvas(center, az3Calibration, view, 172);
    expect(point.x).toBeCloseTo(86, 6);
    expect(point.y).toBeCloseTo(86, 6);
  });

  it("边缘贴靠：玩家贴近边界时视窗整体贴边平移，不越出底图", () => {
    // 角落玩家：视窗被推回边界内。
    const corner = { x: az3Calibration.worldMinX, z: az3Calibration.worldMinZ };
    const view = minimapWindowUv(corner, az3Calibration, SPAN);
    expect(view.u0).toBeCloseTo(0, 9);
    expect(view.v0).toBeCloseTo(0, 9);

    const opposite = { x: az3Calibration.worldMaxX, z: az3Calibration.worldMaxZ };
    const viewMax = minimapWindowUv(opposite, az3Calibration, SPAN);
    expect(viewMax.u1).toBeCloseTo(1, 9);
    expect(viewMax.v1).toBeCloseTo(1, 9);
  });

  it("超大视窗收缩为整图（退化安全）", () => {
    const view = minimapWindowUv({ x: -2000, z: -2000 }, az3Calibration, 1e6);
    expect(view.u0).toBeCloseTo(0, 9);
    expect(view.v0).toBeCloseTo(0, 9);
    expect(view.u1).toBeCloseTo(1, 9);
    expect(view.v1).toBeCloseTo(1, 9);
  });

  it("worldToMinimapCanvas：窗口内点位线性映射到画布", () => {
    const view = { u0: 0.25, v0: 0.25, u1: 0.75, v1: 0.75 };
    const world = {
      x: (az3Calibration.worldMinX + az3Calibration.worldMaxX) / 2,
      z: (az3Calibration.worldMinZ + az3Calibration.worldMaxZ) / 2,
    };
    const point = worldToMinimapCanvas(world, az3Calibration, view, 200);
    // 中心 uv(0.5, 0.5) 在窗口 (0.25..0.75) 的画布中心。
    expect(point.x).toBeCloseTo(100, 6);
    expect(point.y).toBeCloseTo(100, 6);
  });
});

describe("HUD 世界坐标刻度（×100 显示口径）", () => {
  it("管线世界系 (x,z) → (x×100, z×100)，等价源系 (x×100, −z×100)", () => {
    const display = pipelineWorldDisplayCoords({ x: -1657.2, z: -1859.3 });
    expect(display.x).toBeCloseTo(-165720, 6);
    expect(display.y).toBeCloseTo(-185930, 6);
  });
});

import { describe, expect, it } from 'vitest';
import { pipelineWorldToPixel } from './project';
import { markerPixelToWorld, planTeleport, resolveTeleportFloor } from './teleport';
import type { BigmapCalibration } from './types';

/**
 * 传送链路单测（#29 右键标记/POI 点击 → 3D flyTo）：
 * 标定样例取自内置数据包的 AZ3 2D 楼层标定（管线世界系，同 project.test.ts）。
 */
const az3Calibration: BigmapCalibration = {
  worldMinX: -2761.5009765625,
  worldMaxX: -1423.978515625,
  worldMinZ: -2757.5952,
  worldMaxZ: -1489.9634,
  imageWidthPx: 4096,
  imageHeightPx: 4096,
};

/** AZ3 数据包楼层表（manifest.floors 同构）。 */
const AZ3_FLOORS: readonly number[] = [1, 2, 3];

describe('2D 标记 → 3D 传送', () => {
  it('点击像素 → 世界落点 → 回投像素，与点击位置往返一致', () => {
    // 模拟大地图画布点击：可玩区内一点（虚拟网格像素）。
    const clickPixel = { x: 3381.8, y: 2902.6 };
    const world = markerPixelToWorld(clickPixel, az3Calibration);
    // 落点必须落在标定包围盒内（避免飘出底图）。
    expect(world.x).toBeGreaterThanOrEqual(az3Calibration.worldMinX);
    expect(world.x).toBeLessThanOrEqual(az3Calibration.worldMaxX);
    expect(world.z).toBeGreaterThanOrEqual(az3Calibration.worldMinZ);
    expect(world.z).toBeLessThanOrEqual(az3Calibration.worldMaxZ);
    // 3D flyTo 落点回投 2D：与点击像素重合（传送往返）。
    const back = pipelineWorldToPixel(world, az3Calibration);
    expect(back.x).toBeCloseTo(clickPixel.x, 6);
    expect(back.y).toBeCloseTo(clickPixel.y, 6);
  });

  it('planTeleport 产出 3D 落点（标记高度缺省 0，POI 高度透传）', () => {
    const marker = planTeleport({
      world: { x: -2000, z: -2000 },
      targetFloor: null,
      currentFloor: 1,
      floors: AZ3_FLOORS,
    });
    expect(marker.position).toEqual({ x: -2000, y: 0, z: -2000 });
    expect(marker.floor).toBe(1);
    expect(marker.floorChanged).toBe(false);

    const poi = planTeleport({
      world: { x: -2100, z: -2100 },
      worldY: 12.5,
      targetFloor: 2,
      currentFloor: 1,
      floors: AZ3_FLOORS,
    });
    expect(poi.position.y).toBeCloseTo(12.5, 9);
  });

  it('跨层传送楼层同步：目标楼层合法才写入，否则保持当前层', () => {
    const crossFloor = planTeleport({
      world: { x: -2000, z: -2000 },
      targetFloor: 3,
      currentFloor: 1,
      floors: AZ3_FLOORS,
    });
    expect(crossFloor.floor).toBe(3);
    expect(crossFloor.floorChanged).toBe(true);

    // 数据包楼层表之外的楼层不采纳（不把非法楼层写进楼层 store）。
    const invalid = planTeleport({
      world: { x: -2000, z: -2000 },
      targetFloor: 9,
      currentFloor: 1,
      floors: AZ3_FLOORS,
    });
    expect(invalid.floor).toBe(1);
    expect(invalid.floorChanged).toBe(false);
  });

  it('全图概览落点（targetFloor=null）不切层', () => {
    const plan = planTeleport({
      world: { x: -1800, z: -1600 },
      targetFloor: null,
      currentFloor: 2,
      floors: AZ3_FLOORS,
    });
    expect(plan.floor).toBe(2);
    expect(plan.floorChanged).toBe(false);
  });

  it('resolveTeleportFloor：POI 自身楼层优先，楼层 0（全楼层）回落大地图页签', () => {
    expect(resolveTeleportFloor(2, 1)).toBe(2);
    expect(resolveTeleportFloor(0, null)).toBeNull();
    expect(resolveTeleportFloor(0, 3)).toBe(3);
  });
});

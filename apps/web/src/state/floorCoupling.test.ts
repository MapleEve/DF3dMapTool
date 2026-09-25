import { describe, expect, it } from "vitest";
import {
  appFloorToSiteFloor,
  mergeFloorOptions,
  sandboxFloorsToAppDomain,
  siteFloorToAppFloor,
} from "./floorCoupling";

describe("楼层域映射：算术规则（缺省兜底）", () => {
  it("站点 0 基 → 应用 1 基：f<0 原样、f>=0 加一", () => {
    expect(siteFloorToAppFloor(-1)).toBe(-1);
    expect(siteFloorToAppFloor(0)).toBe(1);
    expect(siteFloorToAppFloor(1)).toBe(2);
    expect(siteFloorToAppFloor(2)).toBe(3);
  });

  it("应用 1 基 → 站点 0 基：f<=-1 原样、f>=1 减一；0（全楼层）原样", () => {
    expect(appFloorToSiteFloor(-1)).toBe(-1);
    expect(appFloorToSiteFloor(1)).toBe(0);
    expect(appFloorToSiteFloor(2)).toBe(1);
    expect(appFloorToSiteFloor(3)).toBe(2);
    expect(appFloorToSiteFloor(0)).toBe(0);
  });

  it("已标定地图的双向对齐：零号大坝 site[-1,0,1] ↔ app[-1,1,2]", () => {
    const siteFloors = [-1, 0, 1];
    const appFloors = sandboxFloorsToAppDomain(siteFloors);
    expect(appFloors).toEqual([-1, 1, 2]);
    for (const app of appFloors) {
      expect(siteFloorToAppFloor(appFloorToSiteFloor(app))).toBe(app);
    }
  });

  it("已标定地图的双向对齐：AZ3 site[0,1,2] ↔ app[1,2,3]", () => {
    expect(sandboxFloorsToAppDomain([0, 1, 2])).toEqual([1, 2, 3]);
    expect(appFloorToSiteFloor(3)).toBe(2);
  });

  it("站点值域去重升序", () => {
    expect(sandboxFloorsToAppDomain([1, 0, -1, 2, 0])).toEqual([-1, 1, 2, 3]);
  });
});

describe("楼层域映射：显式映射表优先", () => {
  it("meta.floorMap 逐条覆盖算术规则（防两套楼层标注错位）", () => {
    const floorMap = [
      { site: 0, app: 1 },
      { site: 1, app: 2 },
      { site: 2, app: 4 }, // 站点 2F 对应应用 4 层（假设数据包标定如此）
    ];
    expect(siteFloorToAppFloor(2, floorMap)).toBe(4);
    expect(appFloorToSiteFloor(4, floorMap)).toBe(2);
    // 表缺项回退算术规则
    expect(siteFloorToAppFloor(-1, floorMap)).toBe(-1);
  });
});

describe("楼层选项合并（3D ∪ 2D 沙盘）", () => {
  it("并集升序去重；沙盘表 null 时仅 3D 表", () => {
    expect(mergeFloorOptions([-1, 1, 2], [-1, 1, 2, 3])).toEqual([-1, 1, 2, 3]);
    expect(mergeFloorOptions([1], [1, 2, 3])).toEqual([1, 2, 3]);
    expect(mergeFloorOptions([1, 2], null)).toEqual([1, 2]);
    expect(mergeFloorOptions([], null)).toEqual([]);
  });

  it("3D 单层 + 沙盘多层（巴克什/长弓溪谷类不对齐）：union 兜底", () => {
    // 站点四层 [-1,0,1,2] → app [-1,1,2,3]；3D 单层 [1] → 合并 [-1,1,2,3]
    const sandboxApp = sandboxFloorsToAppDomain([-1, 0, 1, 2]);
    expect(mergeFloorOptions([1], sandboxApp)).toEqual([-1, 1, 2, 3]);
  });
});

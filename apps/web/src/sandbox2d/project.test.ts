/**
 * 站点像素投影回归（设计 §4.3 验收锚点 1/3/4）。
 *
 * 锚定数据为上游渲染 DOM 实测（zoom 1 + 平移偏移 (50, −36)）：
 * - 区域标签 5/5 误差 0px（分析 §3.4 四锚点 + Barracks）
 * - POI 标记（bird-nest 20 条抽样）误差 ≤0.5px（整数舍入）
 * 两套轴约定互为转置（区域 (x,y)、POI (y,x)）为实测锚定，如实锚定勿修正。
 */

import { describe, expect, it } from "vitest";
import {
  clampPan,
  dampPan,
  flyEase,
  fullResToPoint,
  fullResToPopup,
  fullResToRegion,
  overlayToFullRes,
  pointAxesToRegionAxes,
  pointToFullRes,
  popupToFullRes,
  regionToFullRes,
  zoomScale,
} from "./project";

/** DOM 实测：zoom 1 平移偏移。 */
const PAN_X = 50;
const PAN_Y = -36;
const ZOOM1_SCALE = 2 ** (1 - 3); // zoom 1 → 全分辨率 ÷4

function screenAtZoom1(full: { sx: number; sy: number }): { x: number; y: number } {
  return { x: full.sx * ZOOM1_SCALE + PAN_X, y: full.sy * ZOOM1_SCALE + PAN_Y };
}

describe("regionToFullRes：区域标签锚点（DOM 0px 实证）", () => {
  // [name, x, y, DOM translate3d]
  const anchors: Array<[string, number, number, number, number]> = [
    ["Administrative Area", 2720, 2220, 605, 308],
    ["Major Substation", 2006, 2520, 680, 487],
    ["Cement Plant", 2260, 1320, 380, 423],
    ["Visitor Center", 1352, 3200, 850, 650],
    ["Barracks", 2800, 1350, 388, 288],
  ];

  it.each(anchors)("%s → DOM (%s, %s)", (_name, x, y, domX, domY) => {
    const screen = screenAtZoom1(regionToFullRes(x, y));
    expect(Math.abs(screen.x - domX)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(screen.y - domY)).toBeLessThanOrEqual(0.5);
  });
});

describe("pointToFullRes：POI 标记锚点（bird-nest DOM 实测，整数舍入 ≤0.75px）", () => {
  // 数据 (x,y) → DOM translate3d（zoom 1 + pan (50,−36)）
  const anchors: Array<[number, number, number, number]> = [
    [821, 2261, 255, 423],
    [900, 2080, 275, 468],
    [1036, 1895, 309, 514],
    [1895, 2766, 524, 297],
    [2496, 2652, 674, 325],
    [3136, 2028, 834, 481],
    [3156, 1547, 839, 601],
  ];

  it.each(anchors)("POI(%s,%s) → DOM (%s,%s)", (x, y, domX, domY) => {
    const screen = screenAtZoom1(pointToFullRes(x, y));
    expect(Math.abs(screen.x - domX)).toBeLessThanOrEqual(0.75);
    expect(Math.abs(screen.y - domY)).toBeLessThanOrEqual(0.75);
  });
});

describe("两套轴约定互转与逆变换", () => {
  it("region/fullRes 往返恒等", () => {
    const full = regionToFullRes(2720, 2220);
    const back = fullResToRegion(full);
    expect(back.x).toBeCloseTo(2720, 9);
    expect(back.y).toBeCloseTo(2220, 9);
  });

  it("point/fullRes 往返恒等", () => {
    const full = pointToFullRes(821, 2261);
    const back = fullResToPoint(full);
    expect(back.x).toBeCloseTo(821, 9);
    expect(back.y).toBeCloseTo(2261, 9);
  });

  it("POI 轴 → 区域轴：经全分辨率平面一致", () => {
    // POI(821,2261) 与其全分辨率点 (821, 1835)（4096−2261）
    const regionAxes = pointAxesToRegionAxes(821, 2261);
    // 区域轴下同一全分辨率点：sx = y_region = 821? 由 fullResToRegion 链推导
    const full = pointToFullRes(821, 2261);
    const viaRegion = regionToFullRes(regionAxes.x, regionAxes.y);
    expect(viaRegion.sx).toBeCloseTo(full.sx, 9);
    expect(viaRegion.sy).toBeCloseTo(full.sy, 9);
  });
});

describe("楼层叠加矩形（chunk 原式换算，§1.2）", () => {
  it("damiris B1 叠加：锚点 (1408,1890) 宽 780 高 262", () => {
    const rect = overlayToFullRes({ xAnchor: 1408, yAnchor: 1890, width: 780, height: 262 });
    // sx ∈ [xAnchor, xAnchor+width]；sy ∈ [4096−yAnchor−height, 4096−yAnchor]
    expect(rect.x0).toBe(1408);
    expect(rect.w).toBe(780);
    expect(rect.h).toBe(262);
    expect(rect.y0).toBe(4096 - 1890 - 262);
    expect(rect.y0 + rect.h).toBe(4096 - 1890);
    expect(rect.x0 + rect.w).toBe(1408 + 780);
  });
});

describe("右键坐标弹窗口径（逆变换逐字实证）", () => {
  it("x=水平、y=自下而上，Math.round 取整", () => {
    // 全分辨率 (1234.6, 2890.4) → 弹窗 "1235;1206"
    const popup = fullResToPopup({ sx: 1234.6, sy: 2890.4 });
    expect(popup.x).toBe(1235);
    expect(popup.y).toBe(Math.round(4096 - 2890.4));
  });

  it("弹窗 → 全分辨率往返恒等（取整误差内）", () => {
    const popup = fullResToPopup({ sx: 1234.6, sy: 2890.4 });
    const back = popupToFullRes(popup.x, popup.y);
    expect(Math.abs(back.sx - 1234.6)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(back.sy - 2890.4)).toBeLessThanOrEqual(0.5);
  });

  it("右键在 POI 标记上 → 弹窗显示 POI 原始数据坐标（轴口径闭环）", () => {
    const full = pointToFullRes(1188, 2368);
    const popup = fullResToPopup(full);
    expect(popup.x).toBe(1188);
    expect(popup.y).toBe(2368);
  });
});

describe("缩放与视口夹取", () => {
  it("zoomScale：z3 恒等、z1 ÷4、z6 ×8", () => {
    expect(zoomScale(3)).toBe(1);
    expect(zoomScale(1)).toBe(0.25);
    expect(zoomScale(6)).toBe(8);
  });

  it("世界小于视口时居中", () => {
    const clamped = clampPan(999, 999, 1600, 1200, 1024, 1024);
    expect(clamped.x).toBe((1600 - 1024) / 2);
    expect(clamped.y).toBe((1200 - 1024) / 2);
  });

  it("世界大于视口时夹到边界（越上/左界归 0，越下/右界归 viewport−world）", () => {
    expect(clampPan(100, 50, 1000, 800, 4096, 4096)).toEqual({ x: 0, y: 0 });
    expect(clampPan(-5000, -5000, 1000, 800, 4096, 4096)).toEqual({
      x: 1000 - 4096,
      y: 800 - 4096,
    });
    // 界内自由
    expect(clampPan(-200, -50, 1000, 800, 4096, 4096)).toEqual({ x: -200, y: -50 });
  });

  it("越界阻尼（viscosity 0.5）：越界位移减半", () => {
    const damped = dampPan({ x: -100, y: 0 }, { x: 0, y: 0 }, 0.5);
    expect(damped.x).toBe(-50);
    expect(damped.y).toBe(0);
  });
});

describe("flyEase 缓动", () => {
  it("端点 0/1，单调", () => {
    expect(flyEase(0)).toBe(0);
    expect(flyEase(1)).toBe(1);
    let prev = -Infinity;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const e = flyEase(Math.min(1, t));
      expect(e).toBeGreaterThanOrEqual(prev);
      prev = e;
    }
  });
});

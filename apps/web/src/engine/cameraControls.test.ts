import { describe, expect, it } from "vitest";
import { PerspectiveCamera } from "three";
import { MapCameraControls } from "./cameraControls";

const BOUNDS = {
  min: { x: -100, y: 0, z: -100 },
  max: { x: 100, y: 80, z: 100 },
};

function createControls(): MapCameraControls {
  // domElement 传 null：跳过 DOM 事件绑定，但保留 OrbitControls 基类
  // 构造函数末尾 this.update() 的真实调用路径（node 环境可复现）。
  return new MapCameraControls(new PerspectiveCamera(), null as unknown as HTMLElement, {
    bounds: BOUNDS,
  });
}

describe("MapCameraControls", () => {
  it("构造时基类内联调用 update() 不因子类私有字段未初始化而抛错", () => {
    // 回归：OrbitControls 基类构造函数末尾调用 this.update()，此时
    // MapCameraControls 的私有字段尚未初始化，覆写内直接读会抛
    // "Cannot read private member ..."（真机浏览器首载曾命中）。
    expect(() => createControls()).not.toThrow();
  });

  it("构造后 update 持续可用且注视点被钳制在场景范围内", () => {
    const controls = createControls();
    controls.target.set(9999, -50, -9999);
    controls.update(1 / 60);
    expect(controls.target.x).toBeLessThanOrEqual(BOUNDS.max.x);
    expect(controls.target.y).toBeGreaterThanOrEqual(BOUNDS.min.y);
    expect(controls.target.z).toBeGreaterThanOrEqual(BOUNDS.min.z);
  });

  it("flyTo 缓动推进到目标后 promise 以完成收尾", async () => {
    const controls = createControls();
    controls.frameBounds(BOUNDS);
    const target = { x: 10, y: 5, z: 20 };
    const finished = controls.flyTo(target, 120, 200);
    for (let frame = 0; frame < 30 && controls.flying; frame += 1) {
      controls.update(1 / 60);
    }
    await expect(finished).resolves.toBe(true);
    expect(controls.target.x).toBeCloseTo(target.x, 1);
    expect(controls.target.y).toBeCloseTo(target.y, 1);
    expect(controls.target.z).toBeCloseTo(target.z, 1);
  });

  it("用户输入中断缓动：promise 以未完成收尾", async () => {
    const controls = createControls();
    controls.frameBounds(BOUNDS);
    const finished = controls.flyTo({ x: 10, y: 5, z: 20 });
    controls.cancelFlyTo();
    await expect(finished).resolves.toBe(false);
    expect(controls.flying).toBe(false);
  });
});

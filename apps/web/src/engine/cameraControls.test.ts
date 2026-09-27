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

  it("进场默认 FOV 75（上游设置面板实测默认；设置面板值随后覆盖）", () => {
    const controls = createControls();
    controls.frameBounds(BOUNDS);
    expect(controls.fov).toBe(75);
  });

  it("构造后 update 持续可用且注视点被钳制在场景范围内", () => {
    const controls = createControls();
    controls.target.set(9999, -50, -9999);
    controls.update(1 / 60);
    expect(controls.target.x).toBeLessThanOrEqual(BOUNDS.max.x);
    expect(controls.target.y).toBeGreaterThanOrEqual(BOUNDS.min.y);
    expect(controls.target.z).toBeGreaterThanOrEqual(BOUNDS.min.z);
  });

  it("respawnAt 硬传送到出生点：注视点对齐（浮点舍入级）、无缓动、打断既有飞行/跟跑", () => {
    const controls = createControls();
    controls.frameBounds(BOUNDS);
    const points = new Float32Array([0, 2, 0, 0, 2, 40, 0, 2, 80]);
    const follow = controls.startRouteFollow(points, 60);
    const fly = controls.flyTo({ x: 10, y: 5, z: 20 });
    const spawn = { x: -40, y: 3, z: 55 };
    controls.respawnAt(spawn);
    // 遮罩下硬传送：立即到位（无缓动动画），既有飞行/跟跑被打断。
    // 注：OrbitControls.update() 内 target.clampLength(0,∞) 有 ~1e-14 舍入。
    expect(controls.flying).toBe(false);
    expect(controls.routeFollowing).toBe(false);
    expect(controls.target.x).toBeCloseTo(spawn.x, 9);
    expect(controls.target.y).toBeCloseTo(spawn.y, 9);
    expect(controls.target.z).toBeCloseTo(spawn.z, 9);
    // 相机 = 出生点 + 进场取景几何（东南 45° 方位 + 中值仰角 + 进场视距）。
    expect(controls.perspectiveCamera.position.x).toBeGreaterThan(spawn.x);
    expect(controls.perspectiveCamera.position.z).toBeGreaterThan(spawn.z);
    expect(controls.perspectiveCamera.position.y).toBeGreaterThan(spawn.y);
    void follow;
    void fly;
  });

  it("respawnAt 缺省硬传送回进场取景位（注视点与进场中心一致，浮点舍入级）", () => {
    const controls = createControls();
    controls.frameBounds(BOUNDS);
    const entryTarget = controls.target.clone();
    controls.flyTo({ x: 10, y: 5, z: 20 });
    controls.respawnAt(null);
    expect(controls.target.x).toBeCloseTo(entryTarget.x, 9);
    expect(controls.target.y).toBeCloseTo(entryTarget.y, 9);
    expect(controls.target.z).toBeCloseTo(entryTarget.z, 9);
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

  it("跟跑中 flyTo（F 键物件传送/POI 定位）打断跟跑并飞行到位", async () => {
    // 回归：update() 在跟跑激活时提前返回，若 flyTo 不先打断跟跑，
    // 飞行动画永不步进、promise 永不 resolve（跟跑中按 F 传送失效）。
    const controls = createControls();
    controls.frameBounds(BOUNDS);
    const points = new Float32Array([0, 2, 0, 0, 2, 40, 0, 2, 80]);
    const follow = controls.startRouteFollow(points, 60);
    expect(controls.routeFollowing).toBe(true);
    const target = { x: 10, y: 5, z: 20 };
    const finished = controls.flyTo(target, 120, 200);
    await expect(follow).resolves.toBe(false);
    expect(controls.routeFollowing).toBe(false);
    for (let frame = 0; frame < 30 && controls.flying; frame += 1) {
      controls.update(1 / 60);
    }
    await expect(finished).resolves.toBe(true);
    expect(controls.target.x).toBeCloseTo(target.x, 1);
    expect(controls.target.y).toBeCloseTo(target.y, 1);
    expect(controls.target.z).toBeCloseTo(target.z, 1);
  });
});

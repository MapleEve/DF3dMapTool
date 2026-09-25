import { describe, expect, it } from "vitest";
import { decodeRoutePoints, routePointAt } from "./routes";

/** 类型化数组 → base64。 */
function toBase64(view: Float32Array): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  let raw = "";
  for (const byte of bytes) {
    raw += String.fromCharCode(byte);
  }
  return btoa(raw);
}

describe("路线数据解码", () => {
  it("decodeRoutePoints 往返保持坐标（管线世界系，含 z 镜像后的负值）", () => {
    const source = new Float32Array([3309.6, -170.5, -7740, 3313.2, -170.7, -7752.6]);
    const decoded = decodeRoutePoints(toBase64(source));
    expect(decoded.length).toBe(6);
    // float32 精度（约 7 位有效数字）：断言用 3 位小数容差
    expect(decoded[0]).toBeCloseTo(3309.6, 3);
    expect(decoded[2]).toBeCloseTo(-7740, 3);
    expect(decoded[5]).toBeCloseTo(-7752.6, 3);
  });

  it("routePointAt 按下标取点位，越界安全归零", () => {
    const points = decodeRoutePoints(toBase64(new Float32Array([1, 2, 3, 4, 5, 6])));
    expect(routePointAt(points, 0)).toEqual({ x: 1, y: 2, z: 3 });
    expect(routePointAt(points, 1)).toEqual({ x: 4, y: 5, z: 6 });
    expect(routePointAt(points, 99)).toEqual({ x: 0, y: 0, z: 0 });
  });
});

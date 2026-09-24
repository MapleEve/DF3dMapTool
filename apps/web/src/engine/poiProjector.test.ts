import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { projectManyToScreen, projectToScreen } from './poiProjector';

const WIDTH = 800;
const HEIGHT = 600;

function makeCamera(position: [number, number, number], lookAt: [number, number, number]) {
  const camera = new PerspectiveCamera(70, WIDTH / HEIGHT, 0.1, 1000);
  camera.position.set(...position);
  camera.lookAt(...lookAt);
  camera.updateMatrixWorld(true);
  return camera;
}

describe('POI 屏幕投影', () => {
  it('视线正前方点投影到画布中心，距离为视距', () => {
    const camera = makeCamera([0, 0, 0], [0, 0, -1]);
    const anchor = projectToScreen(camera, { x: 0, y: 0, z: -10 }, WIDTH, HEIGHT);
    expect(anchor.x).toBeCloseTo(WIDTH / 2, 5);
    expect(anchor.y).toBeCloseTo(HEIGHT / 2, 5);
    expect(anchor.visible).toBe(true);
    expect(anchor.distance).toBeCloseTo(10, 5);
  });

  it('相机后方点不可见（镜像坐标被抑制）', () => {
    const camera = makeCamera([0, 0, 0], [0, 0, -1]);
    const anchor = projectToScreen(camera, { x: 0, y: 0, z: 10 }, WIDTH, HEIGHT);
    expect(anchor.visible).toBe(false);
    expect(anchor.distance).toBeCloseTo(-10, 5);
  });

  it('视口内偏移点按像素映射；视口外标记不可见但坐标仍输出', () => {
    const camera = makeCamera([0, 0, 0], [0, 0, -1]);
    // 右移 5m、上移 5m，10m 视距：NDC x = 5/(10*tan(35°)*aspect), y = 5/(10*tan(35°))
    const anchor = projectToScreen(camera, { x: 5, y: 5, z: -10 }, WIDTH, HEIGHT);
    const tanHalf = Math.tan((70 / 2) * (Math.PI / 180));
    const ndcX = 5 / (10 * tanHalf * (WIDTH / HEIGHT));
    const ndcY = 5 / (10 * tanHalf);
    expect(anchor.x).toBeCloseTo((ndcX * 0.5 + 0.5) * WIDTH, 3);
    expect(anchor.y).toBeCloseTo((1 - ndcY * 0.5 - 0.5) * HEIGHT, 3);
    expect(anchor.visible).toBe(true);

    const farOff = projectToScreen(camera, { x: 5000, y: 0, z: -10 }, WIDTH, HEIGHT);
    expect(farOff.visible).toBe(false);
  });

  it('世界坐标镜像一致性：Z 取反后投影左右镜像', () => {
    const camera = makeCamera([0, 0, 0], [0, 0, -1]);
    const left = projectToScreen(camera, { x: -5, y: 0, z: -10 }, WIDTH, HEIGHT);
    const right = projectToScreen(camera, { x: 5, y: 0, z: -10 }, WIDTH, HEIGHT);
    expect(WIDTH - left.x).toBeCloseTo(right.x, 5);
  });

  it('批量投影与单点结果一致', () => {
    const camera = makeCamera([100, 50, 200], [-1951, 62, -2076]);
    const worlds = [
      { x: -1951, y: 62, z: -2076 },
      { x: -1600, y: 10, z: -1500 },
      { x: 100, y: 0, z: 0 },
    ];
    const batch = projectManyToScreen(camera, worlds, WIDTH, HEIGHT);
    expect(batch).toHaveLength(3);
    for (let index = 0; index < worlds.length; index += 1) {
      const single = projectToScreen(camera, worlds[index], WIDTH, HEIGHT);
      expect(batch[index]).toEqual(single);
    }
  });
});

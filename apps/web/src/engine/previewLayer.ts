import { DirectionalLight, GridHelper, Group } from 'three';
import type { EngineLayer } from './SceneManager';

/**
 * M1 前的场景占位层：网格地面 + 平行光，
 * 用于验证渲染管线与相机控制；接入真实地图数据后由地图图层替换。
 */
export function createPreviewLayer(): EngineLayer {
  const root = new Group();
  root.name = 'preview-layer';

  const grid = new GridHelper(256, 64, 0x2f4a66, 0x18222e);
  grid.name = 'preview-grid';
  root.add(grid);

  const sun = new DirectionalLight(0xffffff, 1.4);
  sun.position.set(60, 120, 40);
  sun.target.position.set(0, 0, 0);
  root.add(sun);

  return {
    id: 'preview',
    root,
    dispose() {
      grid.dispose();
    },
  };
}

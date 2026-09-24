import { describe, expect, it } from 'vitest';
import { DmapLoader } from '@df3dmaptool/dmap';
import { getMapById } from '@/map/registry';
import { DMAP_KEY_MATERIAL } from '@/engine/dmapKey';
import { floorCalibration, floorImageInfo, readMapPoiData, resolveFloorEntry } from './mapData';
import {
  buildFixtureBundleBytes,
  fixtureManifest,
  FIXTURE_MAP2D,
  FIXTURE_POI,
} from './testBundle';

async function openFixturePoiData() {
  const bytes = await buildFixtureBundleBytes(106);
  const loader = await DmapLoader.open(bytes, DMAP_KEY_MATERIAL);
  const definition = getMapById(106);
  if (definition === undefined) {
    throw new Error('注册表缺少 106 图定义');
  }
  return readMapPoiData({ definition, manifest: fixtureManifest(106), loader });
}

describe('readMapPoiData', () => {
  it('从数据包派生 POI/分类/区域/出生点', async () => {
    const poiData = await openFixturePoiData();

    // active=0 的条目被剔除。
    expect(poiData.pois).toHaveLength(2);

    const spawn = poiData.pois.find((poi) => poi.id === '1060206001');
    expect(spawn).toBeDefined();
    expect(spawn?.displayName).toBe('海边办公楼出生点');
    expect(spawn?.categoryId).toBe('t6');
    expect(spawn?.floor).toBe(0);
    expect(spawn?.position).toEqual({ x: -1657.2, y: 0.2, z: -1859.3 });
    expect(spawn?.iconFile).toBe('icons/csd.png');
    expect(spawn?.description).toBe('出生点描述');
    expect(spawn?.hiddenInBigmap).toBe(false);

    // 物品配置 HideIn2DMap=1 传递到 POI。
    const hidden = poiData.pois.find((poi) => poi.id === '1060206003');
    expect(hidden?.hiddenInBigmap).toBe(true);
    expect(hidden?.categoryId).toBe('t1');

    // 分类来自类型配置。
    expect(poiData.categories.map((category) => category.id)).toEqual(['t1', 't6']);
    expect(poiData.categories[0]?.label).toBe('物资点');

    // 区域按 MapId 过滤并做 Z 镜像归一（源世界 z=1918.68 → 管线 -1918.68）。
    expect(poiData.regions).toHaveLength(1);
    expect(poiData.regions[0]?.name).toBe('乏燃料工厂');
    expect(poiData.regions[0]?.position.z).toBeCloseTo(-1918.68, 6);

    // 出生点同样做 Z 镜像归一。
    expect(poiData.defaultBornPos?.z).toBeCloseTo(-1903, 6);
    expect(poiData.defaultBornPos?.x).toBeCloseTo(-2225.77, 6);

    // 场景包围盒透传（管线世界系）。
    expect(poiData.sceneBounds.min.x).toBeCloseTo(-3195.854, 6);
  });

  it('楼层条目解析：全图概览 / 楼层匹配 / 缺失回退 / 地下层后缀', () => {
    expect(resolveFloorEntry(FIXTURE_MAP2D, null)?.image).toBe('minimap/az3.png');
    expect(resolveFloorEntry(FIXTURE_MAP2D, 1)?.image).toBe('minimap/az3_1f.png');
    expect(resolveFloorEntry(FIXTURE_MAP2D, 3)?.image).toBe('minimap/az3.png');

    const dbLike = {
      ...FIXTURE_MAP2D,
      floors: [
        {
          floorName: 'db',
          worldMinXZ: { x: 0, z: 0 },
          worldMaxXZ: { x: 1, z: 1 },
          playableRectPx: { x: 0, y: 0, width: 1, height: 1 },
          pixelW: 4096,
          pixelH: 4096,
          image: 'minimap/db.png',
          imageSize: [1024, 1024] as const,
        },
        {
          floorName: 'db_-1f',
          worldMinXZ: { x: 0, z: 0 },
          worldMaxXZ: { x: 1, z: 1 },
          playableRectPx: { x: 0, y: 0, width: 1, height: 1 },
          pixelW: 4096,
          pixelH: 4096,
          image: 'minimap/db_-1f.png',
          imageSize: [1024, 1024] as const,
        },
      ],
    };
    expect(resolveFloorEntry(dbLike, -1)?.image).toBe('minimap/db_-1f.png');
    expect(resolveFloorEntry(dbLike, 2)?.image).toBe('minimap/db.png');

    expect(FIXTURE_POI.length).toBeGreaterThan(0);
  });

  it('楼层标定转换与底图信息', () => {
    const entry = resolveFloorEntry(FIXTURE_MAP2D, 1);
    expect(entry).not.toBeNull();
    if (entry === null) {
      return;
    }
    expect(floorCalibration(entry)).toEqual({
      worldMinX: -2761.5,
      worldMaxX: -1423.98,
      worldMinZ: -2757.6,
      worldMaxZ: -1489.96,
      imageWidthPx: 4096,
      imageHeightPx: 4096,
    });
    expect(floorImageInfo(entry)).toEqual({
      file: 'minimap/az3_1f.png',
      width: 2048,
      height: 2048,
    });
  });
});

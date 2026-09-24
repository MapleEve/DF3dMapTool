import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DmapWriter } from '@df3dmaptool/dmap';
import { getMapById, MAPS } from '@/map/registry';
import { DMAP_KEY_MATERIAL } from '@/engine/dmapKey';
import { readMapPoiData } from './mapData';
import {
  loadMapBundle,
  MapDataCorruptError,
  MapDataUnavailableError,
  resetBundleCache,
} from './loadMap';
import { MANIFEST_ENTRY, MANIFEST_FORMAT } from './manifest';
import { buildFixtureBundleBytes } from './testBundle';

const AZ3_URL = getMapById(106)?.bundleUrl ?? '/assets/az3.dmap';

function okResponse(body: Uint8Array): Response {
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: { 'content-length': String(body.byteLength) },
  });
}

beforeEach(() => {
  resetBundleCache();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loadMapBundle', () => {
  it('加载并校验真实容器字节，进度单调推进到 1', async () => {
    const bytes = await buildFixtureBundleBytes(106);
    const fetchMock = vi.fn(async () => okResponse(bytes));
    vi.stubGlobal('fetch', fetchMock);

    const fractions: number[] = [];
    const bundle = await loadMapBundle(106, (fraction) => fractions.push(fraction));

    expect(fetchMock).toHaveBeenCalledWith(AZ3_URL);
    expect(bundle.definition.id).toBe(106);
    expect(bundle.manifest.format).toBe(MANIFEST_FORMAT);
    expect(bundle.manifest.map.code).toBe('az3');
    expect(bundle.manifest.floors).toEqual([1, 2, 3]);
    expect(bundle.loader.has('maps/az3/poi.json')).toBe(true);
    expect(fractions.length).toBeGreaterThan(0);
    for (let index = 1; index < fractions.length; index += 1) {
      expect(fractions[index]).toBeGreaterThanOrEqual(fractions[index - 1]);
    }
    expect(fractions[fractions.length - 1]).toBe(1);
  });

  it('同一地图重复调用共享同一次加载', async () => {
    const bytes = await buildFixtureBundleBytes(106);
    const fetchMock = vi.fn(async () => okResponse(bytes));
    vi.stubGlobal('fetch', fetchMock);

    const first = await loadMapBundle(106);
    const second = await loadMapBundle(106);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('HTTP 404 / 网络失败 → MapDataUnavailableError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('missing', { status: 404 })),
    );
    await expect(loadMapBundle(106)).rejects.toBeInstanceOf(MapDataUnavailableError);

    resetBundleCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down');
      }),
    );
    await expect(loadMapBundle(106)).rejects.toBeInstanceOf(MapDataUnavailableError);
  });

  it('容器字节损坏 → MapDataCorruptError', async () => {
    const garbage = new Uint8Array(128).fill(0x5a);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse(garbage)),
    );
    await expect(loadMapBundle(106)).rejects.toBeInstanceOf(MapDataCorruptError);
  });

  it('manifest 与请求地图不一致 → MapDataCorruptError', async () => {
    const bytes = await buildFixtureBundleBytes(106);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse(bytes)),
    );
    await expect(loadMapBundle(102)).rejects.toMatchObject({
      name: 'MapDataCorruptError',
    });
  });

  it('manifest 格式标识不受支持 → MapDataCorruptError', async () => {
    const tampered = await DmapWriter.create()
      .addJson(MANIFEST_ENTRY, { format: 'other-format/9', maps: [] })
      .write(DMAP_KEY_MATERIAL);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse(tampered)),
    );
    await expect(loadMapBundle(106)).rejects.toBeInstanceOf(MapDataCorruptError);
  });
});

describe('loadMapBundle · 随仓真实容器（6 图）', () => {
  /**
   * 随仓分发的 6 个 .dmap 全部经 fetch → open → manifest 解析 → 派生数据全链：
   * 清洗后的键位（中性语言键、hash 图标路径、null iconFile）若有回归在此暴露。
   */
  const containerBytes = new Map(
    MAPS.map((definition) => {
      const url = new URL(`../../public/assets/${definition.code}.dmap`, import.meta.url);
      return [definition.bundleUrl, new Uint8Array(readFileSync(url))];
    }),
  );

  beforeEach(() => {
    resetBundleCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const bytes = containerBytes.get(String(input));
        if (bytes === undefined) {
          return new Response('missing', { status: 404 });
        }
        return okResponse(bytes);
      }),
    );
  });

  it.for(MAPS.map((definition) => [definition.id, definition.code] as const))(
    '容器 %s（%s）全链通过且清单与派生数据一致',
    async ([mapId, code]) => {
      const bundle = await loadMapBundle(mapId);
      const definition = getMapById(mapId);
      expect(definition).toBeDefined();
      expect(bundle.manifest.map.code).toBe(code);
      expect(bundle.manifest.floors).toEqual(definition?.knownFloors);
      expect(bundle.manifest.entries.scene).toBe(`maps/${code}/scene.json`);

      // 清单声明的资产路径全部真实存在（icons/minimaps 索引 + 全部配置表）。
      for (const path of [
        bundle.manifest.entries.scene,
        bundle.manifest.entries.poi,
        bundle.manifest.entries.map2d,
        bundle.manifest.entries.icons,
        bundle.manifest.entries.minimaps,
        ...bundle.manifest.entries.configs,
      ]) {
        expect(bundle.loader.has(path), path).toBe(true);
      }

      const poiData = readMapPoiData(bundle);
      expect(poiData.mapId).toBe(mapId);
      expect(poiData.pois.length).toBeGreaterThan(0);
      expect(poiData.pois.length).toBeLessThanOrEqual(bundle.manifest.counts.pois);
      expect(poiData.map2d.floors.length).toBeGreaterThan(0);
      expect(poiData.categories.length).toBeGreaterThan(0);

      // 派生 POI 的图标路径（hash 文件名）与 2D 底图路径必须在容器内可读。
      for (const poi of poiData.pois) {
        if (poi.iconFile !== undefined) {
          expect(bundle.loader.has(poi.iconFile), `${poi.id} ${poi.iconFile}`).toBe(true);
        }
      }
      for (const floor of poiData.map2d.floors) {
        expect(bundle.loader.has(floor.image), floor.floorName).toBe(true);
      }
    },
  );

  it('跨图缓存：6 图加载后重复请求不触发新的 fetch', async () => {
    for (const definition of MAPS) {
      await loadMapBundle(definition.id);
    }
    const fetchMock = vi.mocked(fetch);
    const callsAfterFirstPass = fetchMock.mock.calls.length;
    expect(callsAfterFirstPass).toBe(MAPS.length);

    for (const definition of MAPS) {
      await loadMapBundle(definition.id);
    }
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirstPass);
  });
});

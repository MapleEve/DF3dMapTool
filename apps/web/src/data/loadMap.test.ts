import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DmapWriter } from '@df3dmaptool/dmap';
import { getMapById } from '@/map/registry';
import { DMAP_KEY_MATERIAL } from '@/engine/dmapKey';
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
      .addJson(MANIFEST_ENTRY, { format: 'other-format/9', map: { mapId: 106, code: 'az3' } })
      .write(DMAP_KEY_MATERIAL);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse(tampered)),
    );
    await expect(loadMapBundle(106)).rejects.toBeInstanceOf(MapDataCorruptError);
  });
});

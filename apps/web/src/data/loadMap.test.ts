import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { DmapLoader, DmapWriter } from "@df3dmaptool/dmap";
import { getMapById, MAPS } from "@/map/registry";
import { DMAP_KEY_MATERIAL } from "@/engine/dmapKey";
import { readMapPoiData } from "./mapData";
import {
  loadMapBundle,
  MapDataCorruptError,
  MapDataUnavailableError,
  resetBundleCache,
} from "./loadMap";
import { buildFixtureChunkBytes, buildFixtureIndexBytes, FIXTURE_CHUNK_GLB } from "./testBundle";
import { stubGlobal, unstubAllGlobals } from "@/testing/globals";

const AZ3_URL = getMapById(106)?.bundleUrl ?? "/assets/az3/index.dmap";
const AZ3_CHUNK_URL = "/assets/az3/chunks/c_0_0.dmap";

/** Batch2（dmap-map-manifest/2 单图容器）发布时的实测基线；分片重打包不得改变任何规模。 */
const BATCH2_BASELINE: Record<
  number,
  {
    chunks: number;
    instances: number;
    vertices: number;
    triangles: number;
    geometries: number;
    pois: number;
  }
> = {
  101: {
    chunks: 76,
    instances: 42830,
    vertices: 4400193,
    triangles: 3692271,
    geometries: 2927,
    pois: 557,
  },
  102: {
    chunks: 139,
    instances: 52472,
    vertices: 5896772,
    triangles: 4595775,
    geometries: 4542,
    pois: 688,
  },
  104: {
    chunks: 39,
    instances: 28045,
    vertices: 3018988,
    triangles: 2260560,
    geometries: 1829,
    pois: 803,
  },
  105: {
    chunks: 54,
    instances: 28079,
    vertices: 4388334,
    triangles: 3605045,
    geometries: 2277,
    pois: 915,
  },
  106: {
    chunks: 96,
    instances: 45595,
    vertices: 6769100,
    triangles: 5316017,
    geometries: 3362,
    pois: 146,
  },
  203: {
    chunks: 48,
    instances: 23395,
    vertices: 3157823,
    triangles: 2476101,
    geometries: 2928,
    pois: 591,
  },
};

/** 相对测试文件解析随仓资产路径。 */
function assetPath(code: string, rel: string): string {
  return fileURLToPath(new URL(`../../public/assets/${code}/${rel}`, import.meta.url));
}

function okResponse(body: Uint8Array): Response {
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: { "content-length": String(body.byteLength) },
  });
}

/** URL → 磁盘文件映射：索引 / 分块 / 导航容器。 */
const fileFor = (definition: { code: string }, url: string): string | null => {
  const prefix = `/assets/${definition.code}/`;
  if (!url.startsWith(prefix)) {
    return null;
  }
  const rel = url.slice(prefix.length);
  if (rel.startsWith("..") || rel.includes("//")) {
    return null;
  }
  return assetPath(definition.code, rel);
};

/** 以磁盘文件回放 /assets/** 的 fetch（随仓真实分片数据包）。 */
function stubAssetFetch(): void {
  stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const definition = MAPS.find((map) => url.startsWith(`/assets/${map.code}/`));
      const file = definition === undefined ? null : fileFor(definition, url);
      if (file === null || !existsSync(file)) {
        return new Response("missing", { status: 404 });
      }
      return okResponse(new Uint8Array(readFileSync(file)));
    }),
  );
}

/** GLB JSON 段的实例数（引擎口径：实例化 accessor count 之和 + 非实例网格节点 1/个）。 */
function glbInstanceCount(glb: Uint8Array): number {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  let offset = 12;
  for (;;) {
    const len = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (type === 0x4e4f534a) {
      const json = JSON.parse(
        new TextDecoder().decode(new Uint8Array(glb.buffer, glb.byteOffset + offset + 8, len)),
      );
      const accessors = json.accessors ?? [];
      let count = 0;
      for (const node of json.nodes ?? []) {
        const ext = node.extensions?.EXT_mesh_gpu_instancing;
        if (ext) {
          const firstAccessor = Object.values(ext.attributes ?? {})[0] as number | undefined;
          count += firstAccessor === undefined ? 0 : (accessors[firstAccessor]?.count ?? 0);
        } else if (node.mesh !== undefined) {
          count += 1;
        }
      }
      return count;
    }
    offset += 8 + len;
    if (offset >= glb.byteLength) {
      break;
    }
  }
  return -1;
}

beforeEach(() => {
  resetBundleCache();
  stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loadMapBundle", () => {
  it("仅拉索引容器即可就绪，进度单调推进到 1", async () => {
    const index = await buildFixtureIndexBytes(106);
    const fetchMock = vi.fn(async () => okResponse(index));
    stubGlobal("fetch", fetchMock);

    const fractions: number[] = [];
    const bundle = await loadMapBundle(106, (fraction) => fractions.push(fraction));

    expect(fetchMock).toHaveBeenCalledWith(AZ3_URL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bundle.definition.id).toBe(106);
    expect(bundle.manifest.format).toBe("dmap-map-manifest/3");
    expect(bundle.manifest.map.code).toBe("az3");
    expect(bundle.manifest.floors).toEqual([1, 2, 3]);
    expect(bundle.pkg.has("maps/az3/poi.json")).toBe(true);
    expect(fractions.length).toBeGreaterThan(0);
    for (let step = 1; step < fractions.length; step += 1) {
      expect(fractions[step]).toBeGreaterThanOrEqual(fractions[step - 1]);
    }
    expect(fractions[fractions.length - 1]).toBe(1);
  });

  it("分块容器按名惰性拉取并缓存（索引阶段零分块请求）", async () => {
    const index = await buildFixtureIndexBytes(106);
    const chunk = await buildFixtureChunkBytes();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === AZ3_URL) {
        return okResponse(index);
      }
      if (url === AZ3_CHUNK_URL) {
        return okResponse(chunk);
      }
      return new Response("missing", { status: 404 });
    });
    stubGlobal("fetch", fetchMock);

    const bundle = await loadMapBundle(106);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const glb = await bundle.pkg.readChunk(bundle.manifest.chunks[0]!);
    expect([...glb]).toEqual([...FIXTURE_CHUNK_GLB]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(AZ3_CHUNK_URL);

    // 容器缓存：再次读取不再触发网络请求。
    await bundle.pkg.readChunk(bundle.manifest.chunks[0]!);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("同一地图重复调用共享同一次加载", async () => {
    const index = await buildFixtureIndexBytes(106);
    const fetchMock = vi.fn(async () => okResponse(index));
    stubGlobal("fetch", fetchMock);

    const first = await loadMapBundle(106);
    const second = await loadMapBundle(106);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("HTTP 404 / 网络失败 → MapDataUnavailableError", async () => {
    stubGlobal(
      "fetch",
      vi.fn(async () => new Response("missing", { status: 404 })),
    );
    await expect(loadMapBundle(106)).rejects.toBeInstanceOf(MapDataUnavailableError);

    resetBundleCache();
    stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    await expect(loadMapBundle(106)).rejects.toBeInstanceOf(MapDataUnavailableError);
  });

  it("索引容器字节损坏 → MapDataCorruptError", async () => {
    const garbage = new Uint8Array(128).fill(0x5a);
    stubGlobal(
      "fetch",
      vi.fn(async () => okResponse(garbage)),
    );
    await expect(loadMapBundle(106)).rejects.toBeInstanceOf(MapDataCorruptError);
  });

  it("manifest 与请求地图不一致 → MapDataCorruptError", async () => {
    const index = await buildFixtureIndexBytes(106);
    stubGlobal(
      "fetch",
      vi.fn(async () => okResponse(index)),
    );
    await expect(loadMapBundle(102)).rejects.toMatchObject({
      name: "MapDataCorruptError",
    });
  });

  it("manifest 格式标识不受支持 → MapDataCorruptError", async () => {
    const tampered = await DmapWriter.create()
      .addJson("manifest.json", { format: "other-format/9", maps: [] })
      .write(DMAP_KEY_MATERIAL);
    stubGlobal(
      "fetch",
      vi.fn(async () => okResponse(tampered)),
    );
    await expect(loadMapBundle(106)).rejects.toBeInstanceOf(MapDataCorruptError);
  });
});

describe("loadMapBundle · 随仓真实分片数据包（6 图）", () => {
  /**
   * 随仓 6 图的分片容器全部经 fetch → openIndex → 清单解析 → 派生数据全链；
   * 并逐分块读回校验载荷规模与 GLB 结构（与 Batch2 基线对拍）。
   */
  beforeEach(() => {
    resetBundleCache();
    stubAssetFetch();
  });

  // 逐图生成用例（it.for 为 vitest 私有 API，循环注册在 vitest 与 bun:test 下通用）。
  for (const [mapId, code] of MAPS.map((definition) => [definition.id, definition.code] as const)) {
    it(`索引读回与 Batch2 基线一致（${mapId} / ${code}）`, async () => {
      const bundle = await loadMapBundle(mapId);
      const definition = getMapById(mapId);
      expect(definition).toBeDefined();
      expect(bundle.manifest.map.code).toBe(code);
      expect(bundle.manifest.floors).toEqual(definition?.knownFloors);
      expect(bundle.manifest.entries.scene).toBe(`maps/${code}/scene.json`);

      // 分片重打包等价性：全部规模字段与 Batch2 单图容器基线逐项一致。
      expect(bundle.manifest.counts).toEqual(BATCH2_BASELINE[mapId]);
      expect(bundle.manifest.chunks).toHaveLength(BATCH2_BASELINE[mapId]!.chunks);

      // 清单声明的资产路径全部在索引容器内真实存在。
      for (const path of [
        bundle.manifest.entries.scene,
        bundle.manifest.entries.poi,
        bundle.manifest.entries.map2d,
        bundle.manifest.entries.icons,
        bundle.manifest.entries.minimaps,
        ...bundle.manifest.entries.configs,
      ]) {
        expect(bundle.pkg.has(path), path).toBe(true);
      }

      const poiData = readMapPoiData(bundle);
      expect(poiData.mapId).toBe(mapId);
      expect(poiData.pois.length).toBeGreaterThan(0);
      expect(poiData.pois.length).toBeLessThanOrEqual(bundle.manifest.counts.pois);
      expect(poiData.map2d.floors.length).toBeGreaterThan(0);
      expect(poiData.categories.length).toBeGreaterThan(0);

      // 派生 POI 的图标路径与 2D 底图路径必须在索引容器内可读（UI 先到先渲染）。
      for (const poi of poiData.pois) {
        if (poi.iconFile !== undefined) {
          expect(bundle.pkg.has(poi.iconFile), `${poi.id} ${poi.iconFile}`).toBe(true);
        }
      }
      for (const floor of poiData.map2d.floors) {
        expect(bundle.pkg.has(floor.image), floor.floorName).toBe(true);
      }
    });
  }

  for (const [mapId] of MAPS.map((definition) => [definition.id, definition.code] as const)) {
    it(`全部分块容器读回：载荷规模与实例数一致（${mapId}）`, async () => {
      const bundle = await loadMapBundle(mapId);
      let sumInstances = 0;
      let sumPayload = 0;
      for (const chunk of bundle.manifest.chunks) {
        const glb = await bundle.pkg.readChunk(chunk);
        // GLB magic 与载荷字节数。
        expect(String.fromCharCode(glb[0], glb[1], glb[2], glb[3]), chunk.id).toBe("glTF");
        expect(glb.byteLength, chunk.id).toBe(chunk.bytesCompressed);
        // GLB 内实例数与清单一致（等价性的独立复核）。
        expect(glbInstanceCount(glb), chunk.id).toBe(chunk.instances);
        sumInstances += chunk.instances;
        sumPayload += glb.byteLength;
      }
      expect(sumInstances).toBe(bundle.manifest.counts.instances);
      expect(sumPayload).toBe(
        bundle.manifest.chunks.reduce((sum, chunk) => sum + chunk.bytesCompressed, 0),
      );
    });
  }

  it("跨图缓存：6 图加载后重复请求不触发新的 fetch", async () => {
    for (const definition of MAPS) {
      await loadMapBundle(definition.id);
    }
    const fetchMock = fetch as unknown as Mock;
    const callsAfterFirstPass = fetchMock.mock.calls.length;
    expect(callsAfterFirstPass).toBe(MAPS.length);

    for (const definition of MAPS) {
      await loadMapBundle(definition.id);
    }
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirstPass);
  });

  it("导航容器：5 图随仓分发且可解密，az3 无", async () => {
    const navCodes = ["damiris", "forrest", "brakkesh", "tideprison", "spacecenter"];
    for (const code of navCodes) {
      const path = assetPath(code, "nav.dmap");
      expect(existsSync(path), code).toBe(true);
      const loader = await DmapLoader.open(new Uint8Array(readFileSync(path)), DMAP_KEY_MATERIAL);
      expect(loader.has("navmesh.json")).toBe(true);
    }
    expect(existsSync(assetPath("az3", "nav.dmap"))).toBe(false);
  });

  it("单文件 < 90MB（索引/分块/导航容器逐文件核查）", () => {
    const limit = 90 * 1024 * 1024;
    for (const definition of MAPS) {
      const check = (rel: string): void => {
        const file = assetPath(definition.code, rel);
        if (!existsSync(file)) {
          return;
        }
        expect(statSync(file).size, `${definition.code}/${rel}`).toBeLessThan(limit);
      };
      check("index.dmap");
      check("nav.dmap");
      const chunksDir = assetPath(definition.code, "chunks");
      for (const chunk of readdirSync(chunksDir)) {
        check(`chunks/${chunk}`);
      }
    }
  });
});

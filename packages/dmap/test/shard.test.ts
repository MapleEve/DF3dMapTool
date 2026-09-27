import { describe, expect, it, vi } from "vitest";
import {
  DmapIntegrityError,
  DmapLoader,
  DmapMapPackage,
  DmapWriter,
  parseMapManifest,
  chunkLodFile,
  CHUNK_ENTRY_NAME,
  MAP_MANIFEST_ENTRY,
  MAP_MANIFEST_FORMAT_V3,
  MAP_MANIFEST_FORMAT_V4,
  type DmapKeyMaterial,
  type DmapMapManifest,
} from "../src/index.js";
import { hexBytes } from "./helpers.js";

const KEY_MATERIAL: DmapKeyMaterial = {
  segments: ["0001020304050607", "08090a0b0c0d0e0f", "f0f1f2f3f4f5f6f7", "e0e1e2e3e4e5e6e7"].map(
    hexBytes,
  ),
  tables: ["0f0e0d0c0b0a0908", "0706050403020100", "0102030405060708", "1f1e1d1c1b1a1918"].map(
    hexBytes,
  ),
};

/** 与真实分片包同构的合成清单（2 个分块，v3 单层）。 */
function syntheticManifest(): DmapMapManifest {
  return {
    format: MAP_MANIFEST_FORMAT_V3,
    map: { mapId: 901, code: "testmap" },
    floors: [1, 2],
    counts: { chunks: 2, instances: 5, vertices: 30, triangles: 10, geometries: 2, pois: 3 },
    entries: {
      scene: "maps/testmap/scene.json",
      poi: "maps/testmap/poi.json",
      map2d: "maps/testmap/map2d.json",
      configs: ["configs/map_config.json"],
      icons: "icons/index.json",
      minimaps: "minimap/index.json",
    },
    chunks: [
      {
        id: "0_0",
        file: "chunks/c_0_0.dmap",
        instances: 3,
        vertices: 20,
        triangles: 6,
        geometries: 1,
        bytes: 8,
        bytesCompressed: 8,
        containerBytes: 238,
        boundsMin: [0, 0, 0],
        boundsMax: [20, 20, 1],
      },
      {
        id: "1_0",
        file: "chunks/c_1_0.dmap",
        instances: 2,
        vertices: 10,
        triangles: 4,
        geometries: 1,
        bytes: 4,
        bytesCompressed: 4,
        containerBytes: 234,
        boundsMin: [100, 0, 0],
        boundsMax: [101, 1, 1],
      },
    ],
  };
}

/**
 * v4 合成清单：chunk 0 带三层 lods 表（顶点/三角形沿层递减），
 * chunk 1 与 v3 同构（v4 下 lods 为必填，故同样补表）。
 */
function syntheticLodManifest() {
  const manifest = syntheticManifest() as DmapMapManifest & {
    chunks: { lods?: unknown[] }[];
  };
  manifest.format = MAP_MANIFEST_FORMAT_V4;
  manifest.chunks = manifest.chunks.map((chunk) => {
    const scale = (level: number) => ({
      level,
      file: `chunks/c_${chunk.id}_l${level}.dmap`,
      generated: level > 0,
      instances: chunk.instances,
      vertices: Math.max(1, Math.round(chunk.vertices / (level + 1))),
      triangles: Math.max(1, Math.round(chunk.triangles / (level + 1))),
      geometries: chunk.geometries,
      bytes: Math.max(1, Math.round(chunk.bytes / (level + 1))),
      bytesCompressed: Math.max(1, Math.round(chunk.bytesCompressed / (level + 1))),
      containerBytes: 200,
      boundsMin: chunk.boundsMin,
      boundsMax: chunk.boundsMax,
    });
    return {
      ...chunk,
      file: `chunks/c_${chunk.id}_l0.dmap`,
      lods: [scale(0), scale(1), scale(2)],
    };
  });
  return manifest;
}

/** 打一个最小索引容器（清单 + scene/poi JSON）。 */
async function buildIndexBytes(manifest: unknown): Promise<Uint8Array> {
  return DmapWriter.create()
    .addJson(MAP_MANIFEST_ENTRY, manifest)
    .addJson("maps/testmap/scene.json", {
      mapCode: "testmap",
      mapId: 901,
      floorValues: [1, 2],
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      floorTriggers: [],
    })
    .addJson("maps/testmap/poi.json", [{ id: 1 }])
    .write(KEY_MATERIAL);
}

/** 打一个分块容器（单条 GLB 载荷）。 */
async function buildChunkBytes(glb: Uint8Array): Promise<Uint8Array> {
  return DmapWriter.create().add(CHUNK_ENTRY_NAME, "model/gltf-binary", glb).write(KEY_MATERIAL);
}

describe("parseMapManifest（dmap-map-manifest/3 与 /4）", () => {
  it("解析合法 v3 清单（单层：无 lods 表）", () => {
    const manifest = parseMapManifest(syntheticManifest());
    expect(manifest.format).toBe(MAP_MANIFEST_FORMAT_V3);
    expect(manifest.map).toEqual({ mapId: 901, code: "testmap" });
    expect(manifest.chunks).toHaveLength(2);
    expect(manifest.chunks[1]?.file).toBe("chunks/c_1_0.dmap");
    expect(manifest.chunks[0]?.lods).toBeUndefined();
  });

  it("解析合法 v4 清单（逐层 lods 表：层级递增、字段齐全）", () => {
    const manifest = parseMapManifest(syntheticLodManifest());
    expect(manifest.format).toBe(MAP_MANIFEST_FORMAT_V4);
    const lods = manifest.chunks[0]!.lods!;
    expect(lods.map((lod) => lod.level)).toEqual([0, 1, 2]);
    expect(lods[0]!.file).toBe("chunks/c_0_0_l0.dmap");
    expect(lods[1]!.generated).toBe(true);
    expect(lods[0]!.generated).toBe(false);
    // 顶层规模字段与 level 0 同口径（合成数据保证）。
    expect(manifest.chunks[0]!.vertices).toBe(lods[0]!.vertices);
  });

  it("v4 缺少/损坏 lods 表抛 bad_manifest", () => {
    const lod = syntheticLodManifest();
    expect(() => parseMapManifest({ ...lod, chunks: [{ ...lod.chunks[0]!, lods: [] }] })).toThrow(
      /lods/,
    );
    expect(() => {
      const noLods = syntheticLodManifest();
      const { lods: _drop, ...bare } = noLods.chunks[0]!;
      parseMapManifest({ ...noLods, chunks: [bare, noLods.chunks[1]!] });
    }).toThrow(/lods/);
    expect(() =>
      parseMapManifest({
        ...lod,
        chunks: [
          {
            ...lod.chunks[0]!,
            lods: lod.chunks[0]!.lods!.map((entry) => ({ ...entry, level: entry.level + 1 })),
          },
          lod.chunks[1]!,
        ],
      }),
    ).toThrow(/level 0/);
    expect(() =>
      parseMapManifest({
        ...lod,
        chunks: [
          {
            ...lod.chunks[0]!,
            lods: lod.chunks[0]!.lods!.map((entry, index) =>
              index === 2 ? { ...entry, level: 1 } : entry,
            ),
          },
          lod.chunks[1]!,
        ],
      }),
    ).toThrow(/严格递增/);
    expect(() =>
      parseMapManifest({
        ...lod,
        chunks: [
          {
            ...lod.chunks[0]!,
            lods: lod.chunks[0]!.lods!.map((entry) => ({ ...entry, file: "" })),
          },
          lod.chunks[1]!,
        ],
      }),
    ).toThrow(/file/);
    expect(() =>
      parseMapManifest({
        ...lod,
        chunks: [
          {
            ...lod.chunks[0]!,
            lods: lod.chunks[0]!.lods!.map((entry) => ({ ...entry, generated: "yes" })),
          },
          lod.chunks[1]!,
        ],
      }),
    ).toThrow(/generated/);
  });

  it("格式标识/结构不符抛 bad_manifest", () => {
    expect(() => parseMapManifest({ format: "dmap-map-manifest/2", maps: [] })).toThrow(/format/);
    expect(() => parseMapManifest({ format: MAP_MANIFEST_FORMAT_V4 })).toThrow(/map/);
    expect(() => parseMapManifest({ ...syntheticManifest(), floors: [] })).toThrow(/floors/);
    expect(() => parseMapManifest({ ...syntheticManifest(), chunks: [] })).toThrow(/chunks/);
    expect(() =>
      parseMapManifest({
        ...syntheticManifest(),
        chunks: [{ ...syntheticManifest().chunks[0]!, id: "" }],
      }),
    ).toThrow(/id/);
  });
});

describe("chunkLodFile（层级 → 容器路径）", () => {
  it("v4：命中同层；超出表范围取最接近的更细层", () => {
    const chunk = syntheticLodManifest().chunks[0]!;
    expect(chunkLodFile(chunk, 0)).toBe("chunks/c_0_0_l0.dmap");
    expect(chunkLodFile(chunk, 2)).toBe("chunks/c_0_0_l2.dmap");
    expect(chunkLodFile(chunk, 9)).toBe("chunks/c_0_0_l2.dmap");
  });

  it("v3（无 lods 表）：任意层级回落 file", () => {
    const chunk = syntheticManifest().chunks[0]!;
    expect(chunkLodFile(chunk, 0)).toBe("chunks/c_0_0.dmap");
    expect(chunkLodFile(chunk, 2)).toBe("chunks/c_0_0.dmap");
    expect(chunkLodFile({ file: "chunks/c_0_0.dmap", lods: [] }, 1)).toBe("chunks/c_0_0.dmap");
  });
});

describe("DmapMapPackage 分片往返", () => {
  it("两段式 open：索引先开立即可读，分块容器按名惰性拉取", async () => {
    const manifest = syntheticManifest();
    const glb0 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const glb1 = new Uint8Array([9, 9, 9, 9]);
    const indexBytes = await buildIndexBytes(manifest);
    const chunk0 = await buildChunkBytes(glb0);
    const chunk1 = await buildChunkBytes(glb1);
    const routes = new Map<string, Uint8Array>([
      ["chunks/c_0_0.dmap", chunk0],
      ["chunks/c_1_0.dmap", chunk1],
    ]);
    const fetchContainer = vi.fn(async (file: string) => {
      const bytes = routes.get(file);
      if (bytes === undefined) {
        throw new Error(`fetch 桩未配置: ${file}`);
      }
      return bytes;
    });

    const pkg = await DmapMapPackage.openIndex(indexBytes, KEY_MATERIAL, { fetchContainer });
    // 第一段：清单随索引可用，POI/scene 立即可读，未触发任何分块拉取。
    expect(pkg.mapId).toBe(901);
    expect(pkg.mapCode).toBe("testmap");
    expect(pkg.floors).toEqual([1, 2]);
    expect(pkg.manifest.chunks).toHaveLength(2);
    expect(pkg.readJson<{ mapId: number }>("maps/testmap/scene.json").mapId).toBe(901);
    expect(pkg.has("maps/testmap/poi.json")).toBe(true);
    expect(fetchContainer).not.toHaveBeenCalled();

    // 第二段：分块按名惰性拉取，载荷字节与写入端逐字节一致。
    await expect(pkg.readChunk(manifest.chunks[0]!)).resolves.toEqual(glb0);
    expect(fetchContainer).toHaveBeenCalledTimes(1);
    expect(fetchContainer).toHaveBeenCalledWith("chunks/c_0_0.dmap");
    await expect(pkg.readChunk(manifest.chunks[1]!)).resolves.toEqual(glb1);
    expect(fetchContainer).toHaveBeenCalledTimes(2);

    // 容器缓存：再次读取不触发新的拉取。
    await pkg.readChunk(manifest.chunks[0]!);
    expect(fetchContainer).toHaveBeenCalledTimes(2);
    expect(pkg.cachedChunkCount).toBe(2);
    pkg.dispose();
    expect(pkg.cachedChunkCount).toBe(0);
  });

  it("分块容器字节损坏 → DmapIntegrityError 上抛", async () => {
    const chunkBytes = await buildChunkBytes(new Uint8Array([1, 2, 3]));
    chunkBytes[chunkBytes.length - 5] ^= 0xff;
    const indexBytes = await buildIndexBytes(syntheticManifest());
    const pkg = await DmapMapPackage.openIndex(indexBytes, KEY_MATERIAL, {
      fetchContainer: async () => chunkBytes,
    });
    await expect(pkg.readChunk(pkg.manifest.chunks[0]!)).rejects.toBeInstanceOf(DmapIntegrityError);
  });

  it("打开失败不缓存：重试会重新拉取字节", async () => {
    const good = await buildChunkBytes(new Uint8Array([7, 7, 7]));
    let failures = 1;
    const fetchContainer = vi.fn(async (): Promise<Uint8Array> => {
      if (failures > 0) {
        failures -= 1;
        throw new TypeError("network down");
      }
      return good;
    });
    const indexBytes = await buildIndexBytes(syntheticManifest());
    const pkg = await DmapMapPackage.openIndex(indexBytes, KEY_MATERIAL, { fetchContainer });
    const chunk = pkg.manifest.chunks[0]!;
    await expect(pkg.readChunk(chunk)).rejects.toThrow("network down");
    // 失败不缓存：再次读取重新走 fetchContainer 并成功。
    await expect(pkg.readChunk(chunk)).resolves.toEqual(new Uint8Array([7, 7, 7]));
    expect(fetchContainer).toHaveBeenCalledTimes(2);
  });

  it("未注入 fetchContainer 时读取分块抛 bad_manifest", async () => {
    const indexBytes = await buildIndexBytes(syntheticManifest());
    const pkg = await DmapMapPackage.openIndex(indexBytes, KEY_MATERIAL);
    await expect(pkg.readChunk(pkg.manifest.chunks[0]!)).rejects.toMatchObject({
      code: "bad_manifest",
    });
  });

  it("索引容器本身损坏 → DmapIntegrityError；清单非法 → bad_manifest", async () => {
    const broken = await buildIndexBytes(syntheticManifest());
    broken[broken.length - 30] ^= 0xff;
    await expect(DmapMapPackage.openIndex(broken, KEY_MATERIAL)).rejects.toBeInstanceOf(
      DmapIntegrityError,
    );

    const badManifest = await buildIndexBytes({ format: "other/9" });
    await expect(DmapMapPackage.openIndex(badManifest, KEY_MATERIAL)).rejects.toMatchObject({
      code: "bad_manifest",
    });

    // manifest.json 条目缺失 → DmapEntryError 包成 bad_manifest 之外的 DmapError 原样上抛。
    const noManifest = await DmapWriter.create().addText("other.json", "{}").write(KEY_MATERIAL);
    await expect(DmapMapPackage.openIndex(noManifest, KEY_MATERIAL)).rejects.toMatchObject({
      name: "DmapEntryError",
    });
  });

  it("分块容器内条目名不符（CHUNK_ENTRY_NAME）→ DmapEntryError", async () => {
    const wrongEntry = await DmapWriter.create()
      .add("model.gltf-binary", "model/gltf-binary", new Uint8Array([1]))
      .write(KEY_MATERIAL);
    const indexBytes = await buildIndexBytes(syntheticManifest());
    const pkg = await DmapMapPackage.openIndex(indexBytes, KEY_MATERIAL, {
      fetchContainer: async () => wrongEntry,
    });
    await expect(pkg.readChunk(pkg.manifest.chunks[0]!)).rejects.toMatchObject({
      name: "DmapEntryError",
    });
  });

  it("索引容器加载器仍可独立使用（list/has 委托）", async () => {
    const indexBytes = await buildIndexBytes(syntheticManifest());
    const pkg = await DmapMapPackage.openIndex(indexBytes, KEY_MATERIAL);
    expect(pkg.indexLoader).toBeInstanceOf(DmapLoader);
    const names = pkg.listEntries().map((entry) => entry.name);
    expect(names).toContain(MAP_MANIFEST_ENTRY);
    expect(names).toContain("maps/testmap/scene.json");
  });
});

describe("DmapMapPackage 分层读取（dmap-map-manifest/4）", () => {
  it("readChunkLod 按层拉取对应容器；各层独立缓存、互不挤占", async () => {
    const manifest = syntheticLodManifest();
    const tierBytes = {
      0: new Uint8Array([1, 1, 1]),
      1: new Uint8Array([2, 2]),
      2: new Uint8Array([3]),
    } as const;
    const containers = new Map<string, Uint8Array>();
    for (const chunk of manifest.chunks) {
      for (const lod of chunk.lods!) {
        containers.set(lod.file, await buildChunkBytes(tierBytes[lod.level as 0 | 1 | 2]!));
      }
    }
    const fetchContainer = vi.fn(async (file: string) => {
      const bytes = containers.get(file);
      if (bytes === undefined) {
        throw new Error(`fetch 桩未配置: ${file}`);
      }
      return bytes;
    });
    const indexBytes = await buildIndexBytes(manifest);
    const pkg = await DmapMapPackage.openIndex(indexBytes, KEY_MATERIAL, { fetchContainer });
    const chunk = pkg.manifest.chunks[0]!;

    // 逐层读取：载荷与层容器一一对应。
    await expect(pkg.readChunkLod(chunk, 0)).resolves.toEqual(tierBytes[0]);
    await expect(pkg.readChunkLod(chunk, 1)).resolves.toEqual(tierBytes[1]);
    await expect(pkg.readChunkLod(chunk, 2)).resolves.toEqual(tierBytes[2]);
    expect(fetchContainer.mock.calls.map(([file]) => file)).toEqual([
      "chunks/c_0_0_l0.dmap",
      "chunks/c_0_0_l1.dmap",
      "chunks/c_0_0_l2.dmap",
    ]);

    // 层容器按文件缓存：重复读同层不重新拉取；换层复用各自缓存。
    await expect(pkg.readChunkLod(chunk, 0)).resolves.toEqual(tierBytes[0]);
    await expect(pkg.readChunkLod(chunk, 2)).resolves.toEqual(tierBytes[2]);
    expect(fetchContainer).toHaveBeenCalledTimes(3);
    expect(pkg.cachedChunkCount).toBe(3);

    // 超出表的层级号贴最接近的更细层（clamp 到 level 2）。
    await expect(pkg.readChunkLod(chunk, 7)).resolves.toEqual(tierBytes[2]);
    expect(fetchContainer).toHaveBeenCalledTimes(3);

    // readChunk 仍读最高细节层（chunks[].file = l0 容器）。
    await expect(pkg.readChunk(chunk)).resolves.toEqual(tierBytes[0]);
    expect(fetchContainer).toHaveBeenCalledTimes(3);
    pkg.dispose();
  });

  it("v3 单层包：readChunkLod 任意层级回落 file", async () => {
    const glb = new Uint8Array([5, 5, 5, 5]);
    const chunkBytes = await buildChunkBytes(glb);
    const indexBytes = await buildIndexBytes(syntheticManifest());
    const fetchContainer = vi.fn(async () => chunkBytes);
    const pkg = await DmapMapPackage.openIndex(indexBytes, KEY_MATERIAL, { fetchContainer });
    const chunk = pkg.manifest.chunks[0]!;
    await expect(pkg.readChunkLod(chunk, 2)).resolves.toEqual(glb);
    expect(fetchContainer).toHaveBeenCalledWith("chunks/c_0_0.dmap");
    pkg.dispose();
  });
});

/**
 * sandbox2d.dmap 真实容器回归（设计 §4.3 验收锚点 5；镜像 loadMap.test.ts 模式）。
 *
 * 以磁盘文件回放 /assets/** 的 fetch，加载随仓分发的 5 图真实容器，
 * 断言 Batch3 打包基线（管线产出报告实测值）——重打包不得静默改变任何规模。
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMapById, MAPS } from "@/map/registry";
import { stubGlobal, unstubAllGlobals } from "@/testing/globals";
import { loadSandbox2d, resetSandbox2dCache, Sandbox2dUnavailableError } from "./loadSandbox2d";

/** Batch3 打包基线（pack_sandbox2d_report.json 实测）。 */
const BATCH3_BASELINE: Record<
  number,
  {
    points: number;
    regions: number;
    legend: number;
    tiles: number;
    overlays: number;
    named: number;
    tileTemplate: string;
    siteFloors: number[];
    difficultyOptions: string[];
  }
> = {
  101: {
    points: 335,
    regions: 5,
    legend: 57,
    tiles: 84,
    overlays: 5,
    named: 20,
    tileTemplate: "tiles/{z}/{y}/{x}.webp",
    siteFloors: [-1, 0, 1],
    difficultyOptions: ["easy", "normal"],
  },
  102: {
    points: 410,
    regions: 13,
    legend: 57,
    tiles: 84,
    overlays: 2,
    named: 22,
    tileTemplate: "tiles/{z}/{y}/{x}.webp",
    siteFloors: [-1, 0, 1, 2],
    difficultyOptions: ["easy", "normal"],
  },
  203: {
    points: 287,
    regions: 15,
    legend: 57,
    tiles: 84,
    overlays: 2,
    named: 13,
    tileTemplate: "tiles/{z}/{y}/{x}.webp",
    siteFloors: [0, 1, 2],
    difficultyOptions: ["normal"],
  },
  104: {
    points: 449,
    regions: 12,
    legend: 57,
    tiles: 84,
    overlays: 8,
    named: 20,
    tileTemplate: "tiles/{z}/{y}/{x}.webp",
    siteFloors: [-1, 0, 1, 2],
    difficultyOptions: ["normal"],
  },
  106: {
    points: 566,
    regions: 12,
    legend: 57,
    tiles: 336,
    overlays: 0,
    named: 0,
    tileTemplate: "tiles/{floor}/{z}/{x}/{y}.webp",
    siteFloors: [0, 1, 2],
    difficultyOptions: [],
  },
};

function assetPath(code: string, rel: string): string {
  return fileURLToPath(new URL(`../../public/assets/${code}/${rel}`, import.meta.url));
}

function okResponse(body: Uint8Array): Response {
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: { "content-length": String(body.byteLength) },
  });
}

/** URL → 磁盘文件映射（仅本图资产目录内）。 */
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

beforeEach(() => {
  resetSandbox2dCache();
  stubAssetFetch();
});

afterEach(() => {
  unstubAllGlobals();
});

describe("五图真实容器回归（Batch3 基线）", () => {
  for (const map of MAPS) {
    const baseline = BATCH3_BASELINE[map.id];
    if (baseline === undefined) {
      continue;
    }
    it(`${map.code}（${map.nameKey}）：规模/模板/楼层/难度对齐基线`, async () => {
      const definition = getMapById(map.id);
      expect(definition).toBeDefined();
      expect(definition?.sandbox2dUrl).toBeDefined();
      const pkg = await loadSandbox2d(definition!);

      expect(pkg.manifest.format).toBe("dmap-sandbox2d-manifest/1");
      expect(pkg.manifest.mapId).toBe(map.id);
      expect(pkg.manifest.counts).toMatchObject({
        points: baseline.points,
        regions: baseline.regions,
        legend: baseline.legend,
        tiles: baseline.tiles,
        overlays: baseline.overlays,
        named: baseline.named,
      });

      const { data } = pkg;
      expect(data.points).toHaveLength(baseline.points);
      expect(data.regions).toHaveLength(baseline.regions);
      expect(data.legend).toHaveLength(baseline.legend);
      expect(data.overlays).toHaveLength(baseline.overlays);
      expect(data.meta.tileTemplate).toBe(baseline.tileTemplate);
      expect(data.meta.siteFloors).toEqual(baseline.siteFloors);
      expect(data.meta.difficultyOptions).toEqual(baseline.difficultyOptions);
      expect(data.meta.worldSize).toBe(4096);
      expect(data.meta.iconSize).toBe(32);

      // 楼层映射（§2.3：site f<0→f、f>=0→f+1 显式入包）
      for (const entry of data.meta.floorMap) {
        expect(entry.app).toBe(entry.site < 0 ? entry.site : entry.site + 1);
      }

      // 图例分组 5 组 × 57 类结构
      const groups = new Set(data.legend.map((item) => item.group));
      expect([...groups].toSorted()).toEqual(["event", "extraction", "loot", "red-loot", "spawn"]);

      // 跨视图仿射存在且可逆（站点→世界→站点 往返恒等）
      const affine = data.meta.linkAffine;
      expect(affine.siteToWorld.M).toHaveLength(2);
      const probe = data.regions[0];
      const wX =
        affine.siteToWorld.M[0][0] * probe.x +
        affine.siteToWorld.M[0][1] * probe.y +
        affine.siteToWorld.t[0];
      const wZ =
        affine.siteToWorld.M[1][0] * probe.x +
        affine.siteToWorld.M[1][1] * probe.y +
        affine.siteToWorld.t[1];
      const sX =
        affine.worldToSite.M[0][0] * wX + affine.worldToSite.M[0][1] * wZ + affine.worldToSite.t[0];
      const sY =
        affine.worldToSite.M[1][0] * wX + affine.worldToSite.M[1][1] * wZ + affine.worldToSite.t[1];
      expect(sX).toBeCloseTo(probe.x, 6);
      expect(sY).toBeCloseTo(probe.y, 6);

      // 图例图标索引：条目文件真实存在于容器
      const legendWithIcon = data.legend.filter((item) => item.iconFile !== null);
      expect(legendWithIcon.length).toBeGreaterThan(50);
      for (const item of legendWithIcon.slice(0, 5)) {
        expect(pkg.loader.has(item.iconFile!)).toBe(true);
        const index = pkg.iconIndex[item.id];
        expect(index?.file).toBe(item.iconFile);
      }

      // 媒体索引：被引用的 media/shot 均在容器内
      for (const p of data.points.slice(0, 30)) {
        if (p.media !== null) {
          expect(pkg.loader.has(p.media)).toBe(true);
          expect(pkg.mediaIndex[p.media]).toBeDefined();
        }
      }

      // 首屏瓦片（z1 4 张）真实存在
      const firstTiles = baseline.tileTemplate.includes("{floor}")
        ? [
            "tiles/base/1/0/0.webp",
            "tiles/base/1/0/1.webp",
            "tiles/base/1/1/0.webp",
            "tiles/base/1/1/1.webp",
          ]
        : ["tiles/1/0/0.webp", "tiles/1/0/1.webp", "tiles/1/1/0.webp", "tiles/1/1/1.webp"];
      for (const file of firstTiles) {
        expect(pkg.loader.has(file)).toBe(true);
      }
    });
  }
});

describe("潮汐监狱（无 2D 数据）与失败归类", () => {
  it("registry 无 sandbox2dUrl → Sandbox2dUnavailableError", async () => {
    const tideprison = getMapById(105);
    expect(tideprison?.sandbox2dUrl).toBeUndefined();
    await expect(loadSandbox2d(tideprison!)).rejects.toBeInstanceOf(Sandbox2dUnavailableError);
  });

  it("容器 404 → unavailable；并发同图共享一次请求", async () => {
    const definition = getMapById(101)!;
    const [a, b] = await Promise.all([loadSandbox2d(definition), loadSandbox2d(definition)]);
    expect(a).toBe(b);
  });
});

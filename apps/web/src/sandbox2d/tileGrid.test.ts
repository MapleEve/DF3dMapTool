/**
 * 瓦片清单测试（设计 §4.3 验收锚点 3：az3 楼层模板 + z4–6 上采样）。
 *
 * 首屏瓦片集与上游渲染 DOM 实测对齐（zoom 1 视口 1600×1000 → 恰好 4 张 z1 瓦片
 * tiles/1/{0,1}/{0,1}.webp，网络面板实证）。
 */

import { describe, expect, it } from "vitest";
import {
  az3FloorSegment,
  isFloorTemplate,
  tilePath,
  tilesForViewport,
  worldScreenSize,
} from "./tileGrid";

const STANDARD_TEMPLATE = "tiles/{z}/{y}/{x}.webp";
const AZ3_TEMPLATE = "tiles/{floor}/{z}/{x}/{y}.webp";

describe("四图模板 tiles/{z}/{y}/{x}.webp", () => {
  it("zoom 1 居中视口 → 4 张 z1 瓦片（首屏网络面板实证）", () => {
    // zoom 1 世界 1024²，在 1600×1000 视口内居中：offset = ((1600-1024)/2, (1000-1024)/2)
    const tiles = tilesForViewport(
      STANDARD_TEMPLATE,
      {
        width: 1600,
        height: 1000,
        offsetX: 288,
        offsetY: -12,
        zoom: 1,
      },
      undefined,
    );
    expect(tiles.map((t) => t.file).toSorted()).toEqual([
      "tiles/1/0/0.webp",
      "tiles/1/0/1.webp",
      "tiles/1/1/0.webp",
      "tiles/1/1/1.webp",
    ]);
  });

  it("zoom 3 全视野 → 64 张 z3 瓦片（8×8）", () => {
    const tiles = tilesForViewport(
      STANDARD_TEMPLATE,
      {
        width: 4096,
        height: 4096,
        offsetX: 0,
        offsetY: 0,
        zoom: 3,
      },
      undefined,
    );
    expect(tiles).toHaveLength(64);
    expect(tiles.every((t) => t.z === 3)).toBe(true);
    // 部分视野：只取可见行列（视口 1024×512 覆盖世界 [512,1536)×[1024,1536) → 列 1-3 × 行 2-3 = 6 张）
    const partial = tilesForViewport(
      STANDARD_TEMPLATE,
      {
        width: 1024,
        height: 512,
        offsetX: -512,
        offsetY: -1024,
        zoom: 3,
      },
      undefined,
    );
    expect(partial).toHaveLength(6);
    expect(partial.every((t) => t.col >= 1 && t.col <= 3 && (t.row === 2 || t.row === 3))).toBe(
      true,
    );
  });

  it("zoom 4–6 降采样取 z3 瓦片（minNativeZoom/maxNativeZoom 口径）", () => {
    for (const zoom of [4, 5, 6]) {
      const tiles = tilesForViewport(
        STANDARD_TEMPLATE,
        {
          width: 1600,
          height: 1000,
          offsetX: -2200,
          offsetY: -2550,
          zoom,
        },
        undefined,
      );
      expect(tiles.length).toBeGreaterThan(0);
      expect(tiles.every((t) => t.z === 3)).toBe(true);
    }
  });

  it("noWrap：世界外无瓦片（负网格/越界网格剔除）", () => {
    // 视口伸到世界左边界之外（offset 为正 → 世界左移出屏）：不得出现负列
    const left = tilesForViewport(
      STANDARD_TEMPLATE,
      {
        width: 1024,
        height: 512,
        offsetX: 512,
        offsetY: 0,
        zoom: 3,
      },
      undefined,
    );
    expect(left.every((t) => t.col >= 0 && t.col < 8)).toBe(true);
    // 世界左缘在屏幕 512 处：可见列 0-1（负列被 noWrap 剔除）
    expect(left.every((t) => t.col <= 1)).toBe(true);
    // 世界右缘恰在视口右半：仅最末列 7 可见；更右（世界完全出屏）无瓦片
    const right = tilesForViewport(
      STANDARD_TEMPLATE,
      {
        width: 1024,
        height: 512,
        offsetX: -3584,
        offsetY: 0,
        zoom: 3,
      },
      undefined,
    );
    expect(right.length).toBeGreaterThan(0);
    expect(right.every((t) => t.col >= 0 && t.col < 8)).toBe(true);
    expect(right.every((t) => t.col === 7)).toBe(true);
    const beyond = tilesForViewport(
      STANDARD_TEMPLATE,
      {
        width: 1024,
        height: 512,
        offsetX: -4096,
        offsetY: 0,
        zoom: 3,
      },
      undefined,
    );
    expect(beyond).toHaveLength(0);
  });
});

describe("az3 楼层模板 tiles/{floor}/{z}/{x}/{y}.webp", () => {
  it("楼层段：未选→base；站点 f→(f+1)f（chunk 逐字实证）", () => {
    expect(az3FloorSegment(undefined)).toBe("base");
    expect(az3FloorSegment(0)).toBe("1f");
    expect(az3FloorSegment(1)).toBe("2f");
    expect(az3FloorSegment(2)).toBe("3f");
  });

  it("模板判别", () => {
    expect(isFloorTemplate(AZ3_TEMPLATE)).toBe(true);
    expect(isFloorTemplate(STANDARD_TEMPLATE)).toBe(false);
  });

  it("路径替换：{x}=列、{y}=行（与 Leaflet 占位符语义一致）", () => {
    expect(tilePath(AZ3_TEMPLATE, 1, 0, 1, "base")).toBe("tiles/base/1/0/1.webp");
    expect(tilePath(AZ3_TEMPLATE, 2, 3, 2, "3f")).toBe("tiles/3f/2/3/2.webp");
    expect(tilePath(STANDARD_TEMPLATE, 2, 3, 2, "")).toBe("tiles/2/2/3.webp");
  });

  it("az3 首屏 4 张 base 瓦片；选 1F 后整层换源", () => {
    const viewport = { width: 1600, height: 1000, offsetX: 288, offsetY: -12, zoom: 1 };
    const all = tilesForViewport(AZ3_TEMPLATE, viewport, undefined);
    expect(all.map((t) => t.file).toSorted()).toEqual([
      "tiles/base/1/0/0.webp",
      "tiles/base/1/0/1.webp",
      "tiles/base/1/1/0.webp",
      "tiles/base/1/1/1.webp",
    ]);
    const floor1 = tilesForViewport(AZ3_TEMPLATE, viewport, 0);
    expect(floor1.every((t) => t.file.startsWith("tiles/1f/"))).toBe(true);
  });
});

describe("世界屏幕尺寸", () => {
  it("zoom 1→1024、zoom 3→4096、zoom 6→32768", () => {
    expect(worldScreenSize(1)).toEqual({ width: 1024, height: 1024 });
    expect(worldScreenSize(3)).toEqual({ width: 4096, height: 4096 });
    expect(worldScreenSize(6)).toEqual({ width: 32768, height: 32768 });
  });
});

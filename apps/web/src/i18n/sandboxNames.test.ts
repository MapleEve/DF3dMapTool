import { describe, expect, it } from "vitest";
import type { Language } from "./index";
import {
  resolveSandboxLegendName,
  resolveSandboxPointDesc,
  resolveSandboxPointLabel,
  resolveSandboxPointTitle,
  resolveSandboxRegionName,
  TIDE_PRISON_FALLBACK_TITLE,
} from "./sandboxNames";

// 真实数据形状的样例（字段名与 sandbox2d.dmap data.json 的语言字段族一致）
const region = { nameEn: "Administrative Area", nameZh: "行政楼" };
const regionZhMissing = { nameEn: "Barracks", nameZh: null };
const regionEnMissing = { nameEn: null, nameZh: "军营" };

const point = { nameEn: "???#D1-3", titleEn: "Key Card", titleZh: "钥匙卡" };
const pointZhMissing = { nameEn: null, titleEn: "999.9 Gold Bar", titleZh: null };
const pointEnMissing = { nameEn: null, titleEn: null, titleZh: "万足金条" };
const pointBare = { nameEn: null, titleEn: null, titleZh: null }; // rare_spawn：两语言字段均缺

const legend = { nameEn: "Safe" };

describe("2D 沙盘名称语言解析链（设计 §3.2 矩阵）", () => {
  it("区域名：zh→nameZh，en→nameEn，ja/ko 回退 zh 链", () => {
    expect(resolveSandboxRegionName(region, "zh")).toBe("行政楼");
    expect(resolveSandboxRegionName(region, "en")).toBe("Administrative Area");
    expect(resolveSandboxRegionName(region, "ja")).toBe("行政楼");
    expect(resolveSandboxRegionName(region, "ko")).toBe("行政楼");
  });

  it("区域名缺失回退：zh 缺 nameZh 落 nameEn；en 缺 nameEn 落 nameZh", () => {
    expect(resolveSandboxRegionName(regionZhMissing, "zh")).toBe("Barracks");
    expect(resolveSandboxRegionName(regionZhMissing, "ja")).toBe("Barracks");
    expect(resolveSandboxRegionName(regionEnMissing, "en")).toBe("军营");
  });

  it("POI 标题：zh→titleZh(cn_name)，en→titleEn，ja/ko 回退 zh 链", () => {
    expect(resolveSandboxPointTitle(point, "zh")).toBe("钥匙卡");
    expect(resolveSandboxPointTitle(point, "en")).toBe("Key Card");
    expect(resolveSandboxPointTitle(point, "ja")).toBe("钥匙卡");
    expect(resolveSandboxPointTitle(point, "ko")).toBe("钥匙卡");
  });

  it("POI 标题缺失回退：zh 缺 titleZh 落 titleEn；en 缺 titleEn 落 titleZh", () => {
    expect(resolveSandboxPointTitle(pointZhMissing, "zh")).toBe("999.9 Gold Bar");
    expect(resolveSandboxPointTitle(pointZhMissing, "ko")).toBe("999.9 Gold Bar");
    expect(resolveSandboxPointTitle(pointEnMissing, "en")).toBe("万足金条");
  });

  it("POI 标题两字段均缺（rare_spawn 类）：返回 null 交调用侧回退图例名", () => {
    for (const locale of ["zh", "en", "ja", "ko"] as const) {
      expect(resolveSandboxPointTitle(pointBare, locale)).toBeNull();
    }
  });

  it("POI 标签 = name || title（实测规则）：name 优先且不随语言变", () => {
    expect(resolveSandboxPointLabel(point, "zh")).toBe("???#D1-3");
    expect(resolveSandboxPointLabel(point, "en")).toBe("???#D1-3");
    expect(resolveSandboxPointLabel(point, "ja")).toBe("???#D1-3");
    // 无 name 时退化为按语言链解析的标题
    expect(resolveSandboxPointLabel(pointEnMissing, "ja")).toBe("万足金条");
    expect(resolveSandboxPointLabel(pointBare, "zh")).toBeNull();
  });

  it("图例名与描述：站点三 locale 均显英文——全语言恒英文（如实对齐）", () => {
    expect(resolveSandboxLegendName(legend)).toBe("Safe");
    expect(resolveSandboxLegendName({ nameEn: null })).toBeNull();
    expect(resolveSandboxPointDesc({ descEn: "Requires a key card." })).toBe(
      "Requires a key card.",
    );
    expect(resolveSandboxPointDesc({ descEn: null })).toBeNull();
  });

  it("潮汐监狱空态标题：四语言一致直出原始键字面量", () => {
    expect(TIDE_PRISON_FALLBACK_TITLE).toBe("map.CONTROL.TDK.TIDE_PRISON.TITLE");
  });

  it("空字符串视同缺失（防数据包空串占位击穿回退链）", () => {
    expect(resolveSandboxPointTitle({ nameEn: null, titleEn: "Key Card", titleZh: "" }, "zh")).toBe(
      "Key Card",
    );
    expect(resolveSandboxRegionName({ nameEn: "", nameZh: "行政楼" }, "en")).toBe("行政楼");
  });
});

describe("解析链与 i18n 语言的组合面", () => {
  it("Language 四值全部可传入解析且无空结果（组合签名冒烟）", () => {
    const locales: readonly Language[] = ["zh", "en", "ja", "ko"];
    for (const locale of locales) {
      expect(resolveSandboxRegionName(region, locale)).not.toBeNull();
      expect(resolveSandboxPointTitle(point, locale)).not.toBeNull();
      expect(resolveSandboxPointLabel(point, locale)).not.toBeNull();
    }
  });
});

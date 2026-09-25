import { describe, expect, it } from "vitest";
import {
  BOOT_LOADING_TEXT,
  BOOT_TIPS,
  SCENE_LOADING_TEXT,
  SCENE_TIPS,
  bootLogoUrl,
  resolveLoadingLanguage,
} from "./loadingText";

describe("加载页文案数据", () => {
  it("boot/进图标签四语言键齐全（zh/en），boot 带省略号、进图为短标签", () => {
    expect(BOOT_LOADING_TEXT.zh).toBe("加载中...");
    expect(BOOT_LOADING_TEXT.en).toBe("Loading...");
    expect(SCENE_LOADING_TEXT.zh).toBe("加载中");
    expect(SCENE_LOADING_TEXT.en).toBe("Loading");
  });

  it("提示配置：interval 2000 / anim 300，两套提示同长度、非空且无空串", () => {
    for (const config of [BOOT_TIPS.zh, BOOT_TIPS.en, SCENE_TIPS.zh, SCENE_TIPS.en]) {
      expect(config.interval).toBe(2000);
      expect(config.anim).toBe(300);
      expect(config.tips.length).toBeGreaterThan(1);
      expect(config.tips.every((tip) => tip.length > 0)).toBe(true);
    }
    expect(BOOT_TIPS.zh.tips).toHaveLength(BOOT_TIPS.en.tips.length);
    expect(SCENE_TIPS.zh.tips).toHaveLength(SCENE_TIPS.en.tips.length);
  });

  it("boot 屏与进图屏末条提示同源异版（boot 带句尾波浪号，进图不带）", () => {
    const bootZh = BOOT_TIPS.zh.tips;
    const sceneZh = SCENE_TIPS.zh.tips;
    expect(bootZh.at(-1)).toBe("跟着绿色路牌走，怎样都不迷路~");
    expect(sceneZh.at(-1)).toBe("跟着绿色路牌走，怎样都不迷路");
    // 其余条目两套一致。
    expect(bootZh.slice(0, -1)).toEqual(sceneZh.slice(0, -1));
  });

  it("语言解析：zh 开头（含区域变体）→ zh，其余 → en", () => {
    expect(resolveLoadingLanguage("zh")).toBe("zh");
    expect(resolveLoadingLanguage("zh-CN")).toBe("zh");
    expect(resolveLoadingLanguage("ZH-TW")).toBe("zh");
    expect(resolveLoadingLanguage("en")).toBe("en");
    expect(resolveLoadingLanguage("ja")).toBe("en");
    expect(resolveLoadingLanguage("ko")).toBe("en");
    expect(resolveLoadingLanguage(undefined)).toBe("en");
  });

  it("boot logo：zh 用中文版字标，其余用英文版", () => {
    expect(bootLogoUrl("zh")).toBe("/assets/loading/logo-zh.svg");
    expect(bootLogoUrl("en")).toBe("/assets/loading/logo-en.svg");
  });
});

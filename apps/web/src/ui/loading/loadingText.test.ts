import { describe, expect, it } from "vitest";
import {
  BOOT_LOADING_TEXT,
  BOOT_TIPS,
  SCENE_LOADING_TEXT,
  SCENE_TIPS,
  bootLogoUrl,
  resolveLoadingLanguage,
  type LoadingLanguage,
} from "./loadingText";

const LANGS: readonly LoadingLanguage[] = ["zh", "en", "ru", "tw"];

describe("加载页文案数据", () => {
  it("boot/进图标签四语言键齐全，boot 带省略号、进图为短标签", () => {
    expect(BOOT_LOADING_TEXT.zh).toBe("加载中...");
    expect(BOOT_LOADING_TEXT.en).toBe("Loading...");
    expect(BOOT_LOADING_TEXT.ru).toBe("Загрузка...");
    // tw 的 boot 屏加载文案为既定数据的简体写法，如实复刻。
    expect(BOOT_LOADING_TEXT.tw).toBe("加载中...");
    expect(SCENE_LOADING_TEXT.zh).toBe("加载中");
    expect(SCENE_LOADING_TEXT.en).toBe("Loading");
    expect(SCENE_LOADING_TEXT.ru).toBe("Загрузка...");
    expect(SCENE_LOADING_TEXT.tw).toBe("加載中");
  });

  it("提示配置：interval 2000 / anim 300，四语言两套提示同长度、非空且无空串", () => {
    for (const config of [...LANGS.map((l) => BOOT_TIPS[l]), ...LANGS.map((l) => SCENE_TIPS[l])]) {
      expect(config.interval).toBe(2000);
      expect(config.anim).toBe(300);
      expect(config.tips.length).toBeGreaterThan(1);
      expect(config.tips.every((tip) => tip.length > 0)).toBe(true);
    }
    for (const lang of LANGS) {
      expect(BOOT_TIPS[lang].tips).toHaveLength(BOOT_TIPS.zh.tips.length);
      expect(SCENE_TIPS[lang].tips).toHaveLength(SCENE_TIPS.zh.tips.length);
    }
  });

  it("boot 屏与进图屏末条提示同源异版（zh boot 带句尾波浪号，进图不带）", () => {
    const bootZh = BOOT_TIPS.zh.tips;
    const sceneZh = SCENE_TIPS.zh.tips;
    expect(bootZh.at(-1)).toBe("跟着绿色路牌走，怎样都不迷路~");
    expect(sceneZh.at(-1)).toBe("跟着绿色路牌走，怎样都不迷路");
    // 其余条目两套一致；ru/tw 的两套同文（既定数据无波浪号异版）。
    expect(bootZh.slice(0, -1)).toEqual(sceneZh.slice(0, -1));
    expect(BOOT_TIPS.ru.tips).toEqual(SCENE_TIPS.ru.tips);
    expect(BOOT_TIPS.tw.tips).toEqual(SCENE_TIPS.tw.tips);
  });

  it("内容边界：提示语不含站外工具/外部品牌指涉条目（四语两套全量）", () => {
    const banned = ["解密神器", "PC Decoder", "Decoder Tool", "дешифратор"];
    for (const lang of LANGS) {
      for (const tip of [...BOOT_TIPS[lang].tips, ...SCENE_TIPS[lang].tips]) {
        for (const needle of banned) {
          expect(tip.includes(needle)).toBe(false);
        }
      }
    }
  });

  it("提示语为既定四语数据（ru/tw 抽样锚定，末条）", () => {
    expect(BOOT_TIPS.ru.tips.at(-1)).toBe(
      "Следуйте за зелеными указателями, чтобы не заблудиться.",
    );
    expect(BOOT_TIPS.tw.tips.at(-1)).toBe("跟著綠色路牌走，怎樣都不迷路");
    expect(BOOT_TIPS.tw.tips[0]).toBe("可到設定介面開啟空中無限跳喔");
  });

  it("语言解析：zh 开头（含区域变体）→ zh，zh-TW/zh-Hant → tw，en/ru/tw 精确命中，其余回退 en", () => {
    expect(resolveLoadingLanguage("zh")).toBe("zh");
    expect(resolveLoadingLanguage("zh-CN")).toBe("zh");
    expect(resolveLoadingLanguage("zh-TW")).toBe("tw");
    expect(resolveLoadingLanguage("zh-Hant")).toBe("tw");
    expect(resolveLoadingLanguage("en")).toBe("en");
    expect(resolveLoadingLanguage("en-US")).toBe("en");
    expect(resolveLoadingLanguage("ru")).toBe("ru");
    expect(resolveLoadingLanguage("ru-RU")).toBe("ru");
    expect(resolveLoadingLanguage("tw")).toBe("tw");
    expect(resolveLoadingLanguage("ja")).toBe("en");
    expect(resolveLoadingLanguage("ko")).toBe("en");
    expect(resolveLoadingLanguage(undefined)).toBe("en");
  });

  it("boot logo：zh/tw 用中文版字标，en/ru 用英文版", () => {
    expect(bootLogoUrl("zh")).toBe("/assets/loading/logo-zh.svg");
    expect(bootLogoUrl("tw")).toBe("/assets/loading/logo-zh.svg");
    expect(bootLogoUrl("en")).toBe("/assets/loading/logo-en.svg");
    expect(bootLogoUrl("ru")).toBe("/assets/loading/logo-en.svg");
  });
});

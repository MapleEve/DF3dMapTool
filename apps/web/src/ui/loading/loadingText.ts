/**
 * 加载页文案与提示数据（boot 屏 + 进图屏共用一套语言解析）。
 *
 * 语言口径：zh 走中文文案，其余语言（en/ja/ko）走英文文案——ja/ko 无既定加载文案，
 * 沿用应用回退语言 en 的同一套内容，不自造译法。
 *
 * 内容边界：提示语中带外部品牌指涉的条目不入包（公开仓内容口径），
 * 其余条目按原始顺序照抄；boot 屏与进图屏的提示语同源异版
 * （进图屏末条无句尾波浪号），分别保真。
 */

/** boot 屏「加载中」文案（语言 → 文案）。 */
export const BOOT_LOADING_TEXT: Readonly<Record<"zh" | "en", string>> = {
  zh: "加载中...",
  en: "Loading...",
};

/** 进图屏「加载中」短标签（无省略号变体）。 */
export const SCENE_LOADING_TEXT: Readonly<Record<"zh" | "en", string>> = {
  zh: "加载中",
  en: "Loading",
};

/** 提示轮换配置（interval/anim 单位毫秒）。 */
export interface LoadingTipsConfig {
  readonly interval: number;
  readonly anim: number;
  readonly tips: readonly string[];
}

/** boot 屏提示（站点配置口径：interval 2000 / anim 300，末条带句尾波浪号）。 */
export const BOOT_TIPS: Readonly<Record<"zh" | "en", LoadingTipsConfig>> = {
  zh: {
    interval: 2000,
    anim: 300,
    tips: [
      "可到设置界面设置空中无限跳哦",
      "Q键可打开路线面板，跟跑最快免保路线不迷路",
      "选择标注点，开始导航可跟跑导航路线",
      "掉落虚空的时候可以按R键快速回到出生点",
      "M键打开地图查看刷红刷卡点",
      "来PC用解密神器可以一键破解摩斯听力门",
      "按F可以体验游戏内同款摸金体验哦",
      "航天自定义坐标可能有惊喜哦",
      "跟着绿色路牌走，怎样都不迷路~",
    ],
  },
  en: {
    interval: 2000,
    anim: 300,
    tips: [
      "Enable Infinite Air Jump in Settings.",
      "Press Q to open Route Panel. Follow the fastest path to Free Safes.",
      "Select a marker to start navigation and follow the guided path.",
      "Fell into the void? Press R to respawn at start.",
      "Press M to view Red Loot & Keycard spawns.",
      "Use the PC Decoder Tool to instantly solve Morse Code Doors.",
      "Press F to simulate the in-game looting experience.",
      "Custom coordinates in Space Base may hold a surprise.",
      "Follow the Green Signs/Markers to stay on track.",
    ],
  },
};

/** 进图屏底部提示（本地化口径，末条无波浪号）。 */
export const SCENE_TIPS: Readonly<Record<"zh" | "en", LoadingTipsConfig>> = {
  zh: {
    interval: 2000,
    anim: 300,
    tips: [
      "可到设置界面设置空中无限跳哦",
      "Q键可打开路线面板，跟跑最快免保路线不迷路",
      "选择标注点，开始导航可跟跑导航路线",
      "掉落虚空的时候可以按R键快速回到出生点",
      "M键打开地图查看刷红刷卡点",
      "来PC用解密神器可以一键破解摩斯听力门",
      "按F可以体验游戏内同款摸金体验哦",
      "航天自定义坐标可能有惊喜哦",
      "跟着绿色路牌走，怎样都不迷路",
    ],
  },
  en: {
    interval: 2000,
    anim: 300,
    tips: [
      "Enable Infinite Air Jump in Settings.",
      "Press Q to open Route Panel. Follow the fastest path to Free Safes.",
      "Select a marker to start navigation and follow the guided path.",
      "Fell into the void? Press R to respawn at start.",
      "Press M to view Red Loot & Keycard spawns.",
      "Use the PC Decoder Tool to instantly solve Morse Code Doors.",
      "Press F to simulate the in-game looting experience.",
      "Custom coordinates in Space Base may hold a surprise.",
      "Follow the Green Signs/Markers to stay on track.",
    ],
  },
};

/**
 * 解析运行时语言到加载文案语言：zh 开头（含 zh-CN 等区域变体）→ zh，其余 → en。
 */
export function resolveLoadingLanguage(language: string | undefined): "zh" | "en" {
  if (language !== undefined && language.toLowerCase().startsWith("zh")) {
    return "zh";
  }
  return "en";
}

/** boot 屏 logo 资源（zh 用中文版字标，其余用英文版）。 */
export function bootLogoUrl(language: "zh" | "en"): string {
  return language === "zh" ? "/assets/loading/logo-zh.svg" : "/assets/loading/logo-en.svg";
}

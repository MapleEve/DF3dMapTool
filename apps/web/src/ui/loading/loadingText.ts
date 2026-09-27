/**
 * 加载页文案与提示数据（boot 屏 + 进图屏共用一套语言解析）。
 *
 * 语言口径：四语各走各的文案（zh/en/ru/tw，与语言集一致；tw 的 boot 屏
 * 「加载中...」沿用简体写法如实复刻，ru/tw 提示语为既定四语数据）。
 *
 * 内容边界：提示语中带外部品牌/站外工具指涉的条目（站外解码工具导流语）
 * 不入包（公开仓内容口径），其余条目按原始顺序照抄；boot 屏与进图屏的
 * 提示语同源异版（zh 进图屏末条无句尾波浪号），分别保真。
 */

/** 加载文案语言（与 i18n 语言集对应的子集）。 */
export type LoadingLanguage = "zh" | "en" | "ru" | "tw";

/** boot 屏「加载中」文案（语言 → 文案）。 */
export const BOOT_LOADING_TEXT: Readonly<Record<LoadingLanguage, string>> = {
  zh: "加载中...",
  en: "Loading...",
  ru: "Загрузка...",
  // tw 的 boot 屏加载文案为既定数据的简体写法，如实复刻。
  tw: "加载中...",
};

/** 进图屏「加载中」短标签（无省略号变体）。 */
export const SCENE_LOADING_TEXT: Readonly<Record<LoadingLanguage, string>> = {
  zh: "加载中",
  en: "Loading",
  ru: "Загрузка...",
  tw: "加載中",
};

/** 提示轮换配置（interval/anim 单位毫秒）。 */
export interface LoadingTipsConfig {
  readonly interval: number;
  readonly anim: number;
  readonly tips: readonly string[];
}

/** boot 屏提示（站点配置口径：interval 2000 / anim 300；zh 末条带句尾波浪号）。 */
export const BOOT_TIPS: Readonly<Record<LoadingLanguage, LoadingTipsConfig>> = {
  zh: {
    interval: 2000,
    anim: 300,
    tips: [
      "可到设置界面设置空中无限跳哦",
      "Q键可打开路线面板，跟跑最快免保路线不迷路",
      "选择标注点，开始导航可跟跑导航路线",
      "掉落虚空的时候可以按R键快速回到出生点",
      "M键打开地图查看刷红刷卡点",
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
      "Press F to simulate the in-game looting experience.",
      "Custom coordinates in Space Base may hold a surprise.",
      "Follow the Green Signs/Markers to stay on track.",
    ],
  },
  ru: {
    interval: 2000,
    anim: 300,
    tips: [
      "Включите Бесконечный прыжок в настройках.",
      "Нажмите Q, чтобы открыть маршруты. Бегите к бесплатным сейфам самым быстрым путем!",
      "Выберите метку, чтобы начать навигацию и следовать по маршруту.",
      "Упали в текстуры? Нажмите R, чтобы вернуться на спавн.",
      "Нажмите M, чтобы увидеть спавны красного лута и ключ-карт.",
      "Нажмите F, чтобы испытать реалистичный лутинг, как в игре.",
      "На пользовательских координатах Космической базы вас может ждать сюрприз.",
      "Следуйте за зелеными указателями, чтобы не заблудиться.",
    ],
  },
  tw: {
    interval: 2000,
    anim: 300,
    tips: [
      "可到設定介面開啟空中無限跳喔",
      "按 Q 鍵開啟路線面板，跟跑最快免保路線不迷路",
      "選擇標記點，開始導航即可跟隨路線移動",
      "掉落虛空時可按 R 鍵快速回到出生點",
      "按 M 鍵開啟地圖查看紅物與門卡出沒點",
      "按 F 可以體驗遊戲內同款搜刮樂趣喔",
      "航天基地自訂座標可能有驚喜喔",
      "跟著綠色路牌走，怎樣都不迷路",
    ],
  },
};

/** 进图屏底部提示（本地化口径，zh 末条无波浪号）。 */
export const SCENE_TIPS: Readonly<Record<LoadingLanguage, LoadingTipsConfig>> = {
  zh: {
    interval: 2000,
    anim: 300,
    tips: [
      "可到设置界面设置空中无限跳哦",
      "Q键可打开路线面板，跟跑最快免保路线不迷路",
      "选择标注点，开始导航可跟跑导航路线",
      "掉落虚空的时候可以按R键快速回到出生点",
      "M键打开地图查看刷红刷卡点",
      "按F可以体验游戏内同款摸金体验哦",
      "航天自定义坐标可能有惊喜哦",
      "跟着绿色路牌走，怎样都不迷路",
    ],
  },
  en: BOOT_TIPS.en,
  ru: BOOT_TIPS.ru,
  tw: BOOT_TIPS.tw,
};

/**
 * 解析运行时语言到加载文案语言：zh 开头（含 zh-CN 等区域变体）→ zh，
 * en/ru/tw 精确匹配各走各语；其余（未支持或区域变体）回退 en。
 */
export function resolveLoadingLanguage(language: string | undefined): LoadingLanguage {
  if (language === undefined) {
    return "en";
  }
  const normalized = language.toLowerCase();
  if (normalized.startsWith("zh")) {
    // zh-TW 区域变体归 tw（tw 语在语言集内自成一键）；其余 zh* 归 zh。
    return normalized === "zh-tw" || normalized === "zh-hant" ? "tw" : "zh";
  }
  if (normalized.startsWith("en")) {
    return "en";
  }
  if (normalized.startsWith("ru")) {
    return "ru";
  }
  if (normalized.startsWith("tw")) {
    return "tw";
  }
  return "en";
}

/** boot 屏 logo 资源（zh/tw 用中文版字标，en/ru 用英文版）。 */
export function bootLogoUrl(language: LoadingLanguage): string {
  return language === "zh" || language === "tw"
    ? "/assets/loading/logo-zh.svg"
    : "/assets/loading/logo-en.svg";
}

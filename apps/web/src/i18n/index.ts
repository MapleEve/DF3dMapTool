import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./en";
import { ru } from "./ru";
import { tw } from "./tw";
import { zh } from "./zh";

export const SUPPORTED_LANGUAGES = ["zh", "en", "ru", "tw"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
/** 默认语言：中文。 */
export const DEFAULT_LANGUAGE: Language = "zh";
/** 语言偏好的持久化键（uiStore.setLanguage 同步写入）。 */
export const LANGUAGE_STORAGE_KEY = "df3dmaptool:language";
/** 语言选择器显示名（各自语言的本土名，不随当前语言翻译）。 */
export const LANGUAGE_LABELS: Readonly<Record<Language, string>> = {
  zh: "中文",
  en: "English",
  ru: "Русский",
  tw: "繁體中文",
};
/** html lang 属性值（zh 用区域子标签，与 index.html 初始声明一致）。 */
const HTML_LANG_TAGS: Readonly<Record<Language, string>> = {
  zh: "zh-CN",
  en: "en",
  ru: "ru",
  tw: "zh-TW",
};

export type { TranslationSchema } from "./zh";

/**
 * 语言代码归一（入口参数与浏览器语言共用口径）：小写后取前两字符。
 * zh-CN/zh-TW → zh、en-US → en；tw 无区域前缀形态，仅 `?lang=tw` 直接命中。
 */
export function normalizeLanguageCode(value: string): string {
  return value.trim().toLowerCase().substring(0, 2);
}

/** 读取持久化的语言偏好（initI18n 与 uiStore 共用；异常/缺失/非法值回退默认语言）。 */
export function readStoredLanguage(): Language {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return stored !== null && isLanguage(stored) ? stored : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/** 持久化偏好是否存在且合法（用于区分「存过 zh」与「从未存过」）。 */
function peekStoredLanguage(): Language | null {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return stored !== null && isLanguage(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** 写入持久化偏好（入口参数命中时固化；隐私模式静默失败）。 */
function persistLanguage(language: Language): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // 持久化失败不阻塞语言应用。
  }
}

/** URL `?lang=` 入口参数：非法/不支持值返回 null（按原口径回退默认语言）。 */
export function readUrlLanguage(): Language | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = new URLSearchParams(window.location.search).get("lang");
  if (raw === null || raw.trim() === "") {
    return null;
  }
  const normalized = normalizeLanguageCode(raw);
  return isLanguage(normalized) ? normalized : null;
}

/** `?lang=` 参数是否出现（含非法值——出现即覆盖存档与浏览器检测）。 */
function hasUrlLanguageParam(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const raw = new URLSearchParams(window.location.search).get("lang");
  return raw !== null && raw.trim() !== "";
}

/** 浏览器语言检测（navigator.language 前两字符归一；不支持时 null）。 */
export function detectNavigatorLanguage(): Language | null {
  if (typeof navigator === "undefined") {
    return null;
  }
  const raw = navigator.language ?? (navigator as { userLanguage?: string }).userLanguage;
  if (typeof raw !== "string" || raw === "") {
    return null;
  }
  const normalized = normalizeLanguageCode(raw);
  return isLanguage(normalized) ? normalized : null;
}

/**
 * 初始语言解析链（启动一次性）：`?lang=` 参数 > 持久化偏好 > 浏览器语言 > 默认 zh。
 * 参数出现即最优先（非法值按原口径落默认 zh，不再看存档/浏览器）；
 * 合法参数由 initI18n 固化进存档（等效「入口即选定语言」）。
 */
export function resolveInitialLanguage(): Language {
  if (hasUrlLanguageParam()) {
    return readUrlLanguage() ?? DEFAULT_LANGUAGE;
  }
  const stored = peekStoredLanguage();
  if (stored !== null) {
    return stored;
  }
  return detectNavigatorLanguage() ?? DEFAULT_LANGUAGE;
}

/** 同步 <html lang> 属性与当前语言（SSR/测试环境无 document 时静默跳过）。 */
function applyHtmlLangTag(language: Language): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.lang = HTML_LANG_TAGS[language];
}

let initPromise: Promise<void> | null = null;

/**
 * 幂等初始化；在 main.tsx 渲染前调用，解析初始语言（URL 参数 > 存档 > 浏览器）。
 * 幂等语义：每次调用都把语言重新对齐到当前初始语言——bun test 跨测试文件
 * 共享 i18next 单例，后执行的文件再次 initI18n 时由此消除前序文件切换
 * 语言带来的执行顺序依赖；应用运行时仅 main.tsx 调用一次，行为不变。
 */
export function initI18n(): Promise<void> {
  initPromise ??= i18next
    .use(initReactI18next)
    .init({
      lng: resolveInitialLanguage(),
      fallbackLng: "en",
      resources: {
        zh: { translation: zh },
        en: { translation: en },
        ru: { translation: ru },
        tw: { translation: tw },
      },
      interpolation: { escapeValue: false },
    })
    .then(() => {
      const current = i18next.language;
      applyHtmlLangTag(isLanguage(current) ? current : DEFAULT_LANGUAGE);
    });
  return initPromise.then(() => changeLanguage(resolveInitialLanguage()));
}

export async function changeLanguage(language: Language): Promise<void> {
  // i18next 未初始化时（如测试或早期调用）先完成初始化再切换。
  if (!i18next.isInitialized) {
    await initI18n();
  }
  await i18next.changeLanguage(language);
  applyHtmlLangTag(language);
}

export function isLanguage(value: string): value is Language {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/**
 * 应用初始语言到 i18next 与持久化存档（main.tsx 渲染前调用一次）：
 * - `?lang=` 合法命中 → 应用并固化进存档（后续无参访问保持该语言）；
 * - 其余情况维持解析链结果（存档/浏览器检测/默认 zh），不动存档。
 */
export function applyInitialLanguage(): Promise<void> {
  const language = resolveInitialLanguage();
  if (hasUrlLanguageParam() && readUrlLanguage() !== null) {
    persistLanguage(language);
  }
  return changeLanguage(language);
}

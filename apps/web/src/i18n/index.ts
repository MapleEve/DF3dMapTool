import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./en";
import { ja } from "./ja";
import { ko } from "./ko";
import { zh } from "./zh";

export const SUPPORTED_LANGUAGES = ["zh", "en", "ja", "ko"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
/** 默认语言：中文。 */
export const DEFAULT_LANGUAGE: Language = "zh";
/** 语言偏好的持久化键（uiStore.setLanguage 同步写入）。 */
export const LANGUAGE_STORAGE_KEY = "df3dmaptool:language";
/** 语言选择器显示名（各自语言的本土名，不随当前语言翻译）。 */
export const LANGUAGE_LABELS: Readonly<Record<Language, string>> = {
  zh: "中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
};
/** html lang 属性值（zh 用区域子标签，与 index.html 初始声明一致）。 */
const HTML_LANG_TAGS: Readonly<Record<Language, string>> = {
  zh: "zh-CN",
  en: "en",
  ja: "ja",
  ko: "ko",
};

export type { TranslationSchema } from "./zh";

/** 读取持久化的语言偏好（initI18n 与 uiStore 共用；异常/缺失/非法值回退默认语言）。
 *  旧存量 zh/en 值与新 ja/ko 值均直接兼容。 */
export function readStoredLanguage(): Language {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return stored !== null && isLanguage(stored) ? stored : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/** 同步 <html lang> 属性与当前语言（SSR/测试环境无 document 时静默跳过）。 */
function applyHtmlLangTag(language: Language): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.lang = HTML_LANG_TAGS[language];
}

let initPromise: Promise<void> | null = null;

/** 幂等初始化；在 main.tsx 渲染前调用，恢复持久化的语言偏好。 */
export function initI18n(): Promise<void> {
  initPromise ??= i18next
    .use(initReactI18next)
    .init({
      lng: readStoredLanguage(),
      fallbackLng: "en",
      resources: {
        zh: { translation: zh },
        en: { translation: en },
        ja: { translation: ja },
        ko: { translation: ko },
      },
      interpolation: { escapeValue: false },
    })
    .then(() => {
      const current = i18next.language;
      applyHtmlLangTag(isLanguage(current) ? current : DEFAULT_LANGUAGE);
    });
  return initPromise;
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

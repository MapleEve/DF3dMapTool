import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './en';
import { zh } from './zh';

export const SUPPORTED_LANGUAGES = ['zh', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
/** 默认语言：中文。 */
export const DEFAULT_LANGUAGE: Language = 'zh';
/** 语言偏好的持久化键（uiStore.setLanguage 同步写入）。 */
export const LANGUAGE_STORAGE_KEY = 'df3dmaptool:language';

export type { TranslationSchema } from './zh';

function readStoredLanguage(): Language {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return stored === 'en' || stored === 'zh' ? stored : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

let initPromise: Promise<void> | null = null;

/** 幂等初始化；在 main.tsx 渲染前调用，恢复持久化的语言偏好。 */
export function initI18n(): Promise<void> {
  initPromise ??= i18next
    .use(initReactI18next)
    .init({
      lng: readStoredLanguage(),
      fallbackLng: 'en',
      resources: {
        zh: { translation: zh },
        en: { translation: en },
      },
      interpolation: { escapeValue: false },
    })
    .then(() => undefined);
  return initPromise;
}

export async function changeLanguage(language: Language): Promise<void> {
  // i18next 未初始化时（如测试或早期调用）先完成初始化再切换。
  if (!i18next.isInitialized) {
    await initI18n();
  }
  await i18next.changeLanguage(language);
}

export function isLanguage(value: string): value is Language {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

import type { TranslationSchema } from './zh';

declare module 'i18next' {
  interface CustomTypeOptions {
    resources: {
      translation: TranslationSchema;
    };
  }
}

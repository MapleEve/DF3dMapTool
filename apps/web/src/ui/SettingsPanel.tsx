import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, type Language } from '@/i18n';
import { useUiStore, type QualityLevel } from '@/state/uiStore';

const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];

/** 设置面板：画质（渲染像素比）与界面语言。 */
export function SettingsPanel() {
  const { t } = useTranslation();
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const quality = useUiStore((state) => state.quality);
  const setQuality = useUiStore((state) => state.setQuality);
  const language = useUiStore((state) => state.language);
  const setLanguage = useUiStore((state) => state.setLanguage);

  if (!settingsOpen) {
    return null;
  }

  const handleLanguageChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    if (SUPPORTED_LANGUAGES.includes(next as Language)) {
      setLanguage(next as Language);
    }
  };

  return (
    <div className="settings-backdrop" onClick={() => setSettingsOpen(false)}>
      <section
        className="settings-panel"
        role="dialog"
        aria-label={t('settings.title')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <h2>{t('settings.title')}</h2>
          <button type="button" onClick={() => setSettingsOpen(false)} aria-label={t('common.close')}>
            ×
          </button>
        </header>

        <div className="settings-row">
          <label htmlFor="settings-quality">{t('settings.quality')}</label>
          <select
            id="settings-quality"
            value={quality}
            onChange={(event) => {
              const next = event.target.value;
              if (QUALITY_LEVELS.includes(next as QualityLevel)) {
                setQuality(next as QualityLevel);
              }
            }}
          >
            {QUALITY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {t(`settings.qualityLevels.${level}`)}
              </option>
            ))}
          </select>
        </div>
        <p className="settings-hint">{t('settings.qualityHint')}</p>

        <div className="settings-row">
          <label htmlFor="settings-language">{t('settings.language')}</label>
          <select id="settings-language" value={language} onChange={handleLanguageChange}>
            {SUPPORTED_LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {code === 'zh' ? '中文' : 'English'}
              </option>
            ))}
          </select>
        </div>
      </section>
    </div>
  );
}

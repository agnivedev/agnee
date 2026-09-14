import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { messages, type Locale, type MessageKey } from './messages';

const STORAGE_KEY = 'agnee_locale';

function readInitialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'id' || saved === 'en') return saved;
  } catch {
    /* private mode or blocked storage — fall through to the browser language */
  }
  return navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'id';
}

export type Translate = (key: MessageKey | (string & {}), vars?: Record<string, string | number>) => string;

type I18nValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: Translate;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readInitialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* the language still applies for this visit, it just will not be remembered */
    }
  }, []);

  const t = useCallback<Translate>(
    (key, vars) => {
      const dictionary = messages[locale] as Record<string, string>;
      let value = dictionary[key] ?? (messages.id as Record<string, string>)[key] ?? String(key);
      if (vars) {
        for (const [name, replacement] of Object.entries(vars)) {
          value = value.replaceAll(`{${name}}`, String(replacement));
        }
      }
      return value;
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside <I18nProvider>');
  return context;
}

/** Sets document.title from a translation key, and keeps it in sync with the language. */
export function usePageTitle(key: MessageKey | (string & {})) {
  const { t } = useI18n();
  useEffect(() => {
    document.title = t(key);
  }, [t, key]);
}

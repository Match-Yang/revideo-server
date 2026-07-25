"use client";

import * as React from "react";
import { dictionaries, type Locale, type Dictionary } from "./dictionaries";

const STORAGE_KEY = "revideo.locale";
const defaultLocale: Locale = "zh";

function readNested(source: Dictionary, key: string): string {
  const keys = key.split(".");
  let current: unknown = source;
  for (const k of keys) {
    if (current && typeof current === "object" && k in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[k];
    } else {
      return key;
    }
  }
  return typeof current === "string" ? current : key;
}

function format(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? `{${key}}`));
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

const I18nContext = React.createContext<I18nContextValue>({
  locale: defaultLocale,
  setLocale: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = React.useState<Locale>(() => {
    if (typeof window === "undefined") return defaultLocale;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "zh") return stored;
    return defaultLocale;
  });

  const setLocale = React.useCallback((next: Locale) => {
    setLocaleState(next);
    localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.lang = next;
  }, []);

  React.useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = React.useCallback(
    (key: string, values?: Record<string, string | number>): string => {
      const text = readNested(dictionaries[locale], key);
      if (text === key && locale !== "zh") {
        return format(readNested(dictionaries.zh, key), values);
      }
      return format(text, values);
    },
    [locale],
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return React.useContext(I18nContext);
}

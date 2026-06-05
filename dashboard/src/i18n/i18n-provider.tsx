"use client";

import * as React from "react";

import { dictionaries, type Locale } from "./dictionaries";

export type { Locale } from "./dictionaries";

const STORAGE_KEY = "revideo.locale";

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
};

const I18nContext = React.createContext<I18nContextValue | null>(null);

function readNested(source: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in acc) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, source);
}

function format(template: string, values?: Record<string, string | number>) {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = React.useState<Locale>("zh");

  React.useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    const nextLocale = saved === "en" || saved === "zh" ? saved : "zh";
    setLocaleState(nextLocale);
    document.documentElement.lang = nextLocale === "zh" ? "zh-CN" : "en";
  }, []);

  const setLocale = React.useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    window.localStorage.setItem(STORAGE_KEY, nextLocale);
    document.documentElement.lang = nextLocale === "zh" ? "zh-CN" : "en";
  }, []);

  const t = React.useCallback(
    (key: string, values?: Record<string, string | number>) => {
      const value = readNested(dictionaries[locale], key) ?? readNested(dictionaries.zh, key) ?? key;
      return format(String(value), values);
    },
    [locale],
  );

  const value = React.useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = React.useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return context;
}

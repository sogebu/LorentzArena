import { createContext, type ReactNode, useCallback, useContext, useState } from "react";
import { ja, type TranslationKey } from "./translations/ja";
import { en } from "./translations/en";

export type Lang = "ja" | "en";

const dictionaries: Record<Lang, Record<string, string>> = { ja, en };

interface I18nContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TranslationKey) => string;
  langChosen: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = "la-lang";

const getStoredLang = (): Lang | null => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "ja") return stored;
  } catch {
    // localStorage unavailable
  }
  return null;
};

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const stored = getStoredLang();
  const [lang, setLangState] = useState<Lang>(stored ?? "ja");
  const [langChosen, setLangChosen] = useState(stored !== null);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    setLangChosen(true);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
  }, []);

  const t = useCallback(
    (key: TranslationKey): string => {
      return dictionaries[lang][key] ?? dictionaries.ja[key] ?? key;
    },
    [lang],
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, t, langChosen }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = (): I18nContextValue => {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
};

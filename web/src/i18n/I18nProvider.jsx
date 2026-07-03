import React, { createContext, useContext, useMemo, useState } from "react";
import { defaultLanguage, interpolate, translations } from "./translations.js";

const I18nContext = createContext({
  language: defaultLanguage,
  setLanguage: () => {},
  t: (key) => key
});

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(() => localStorage.getItem("language") || defaultLanguage);

  const setLanguage = (nextLanguage) => {
    const safeLanguage = translations[nextLanguage] ? nextLanguage : defaultLanguage;
    localStorage.setItem("language", safeLanguage);
    document.documentElement.lang = safeLanguage;
    setLanguageState(safeLanguage);
  };

  const value = useMemo(() => ({
    language,
    setLanguage,
    t: (key, values) => interpolate(translations[language]?.[key] || translations.en[key] || key, values)
  }), [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

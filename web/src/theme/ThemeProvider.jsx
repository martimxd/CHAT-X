import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

const THEME_KEY = "chatx_theme";

const ThemeContext = createContext({
  theme: "system",
  setTheme: () => {}
});

function applyTheme(theme) {
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const resolved = theme === "system" ? (prefersDark ? "dark" : "light") : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => localStorage.getItem(THEME_KEY) || "system");

  useEffect(() => {
    applyTheme(theme);
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const listener = () => applyTheme(theme);
    media?.addEventListener?.("change", listener);
    return () => media?.removeEventListener?.("change", listener);
  }, [theme]);

  const setTheme = (nextTheme) => {
    const safeTheme = ["light", "dark", "system"].includes(nextTheme) ? nextTheme : "system";
    localStorage.setItem(THEME_KEY, safeTheme);
    setThemeState(safeTheme);
  };

  const value = useMemo(() => ({ theme, setTheme }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

import React from "react";
import { Laptop, Moon, Sun } from "lucide-react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useTheme } from "../theme/ThemeProvider.jsx";

export function ThemeToggle({ compact = false }) {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const options = [
    { value: "light", label: t("lightMode"), icon: <Sun size={16} /> },
    { value: "dark", label: t("darkMode"), icon: <Moon size={16} /> },
    { value: "system", label: t("systemMode"), icon: <Laptop size={16} /> }
  ];

  return (
    <div className={`theme-toggle ${compact ? "compact" : ""}`} role="group" aria-label={t("theme")}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={theme === option.value ? "active" : ""}
          onClick={() => setTheme(option.value)}
          title={option.label}
          aria-label={option.label}
        >
          {option.icon}
          {!compact && <span>{option.label}</span>}
        </button>
      ))}
    </div>
  );
}

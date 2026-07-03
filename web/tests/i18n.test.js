import { describe, expect, it } from "vitest";
import { translations } from "../src/i18n/translations.js";

describe("translations", () => {
  it("keeps every locale aligned with English keys", () => {
    const englishKeys = Object.keys(translations.en).sort();
    for (const [language, dictionary] of Object.entries(translations)) {
      expect(Object.keys(dictionary).sort(), language).toEqual(englishKeys);
    }
  });

  it("does not leave empty visible strings", () => {
    for (const [language, dictionary] of Object.entries(translations)) {
      for (const [key, value] of Object.entries(dictionary)) {
        expect(value, `${language}.${key}`).toBeTruthy();
      }
    }
  });
});

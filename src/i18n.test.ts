import { describe, expect, test } from "bun:test";
import { getLocale, strings, t } from "./i18n";

describe("t", () => {
  test("returns the key for an unknown message", () => {
    expect(t("definitely-not-a-key")).toBe("definitely-not-a-key");
  });

  test("returns the English text for a known key", () => {
    expect(t("exclusions")).not.toBe("exclusions");
  });

  test("substitutes {placeholders}", () => {
    expect(t("savedSearchCmd", { name: "Work" })).toContain("Work");
    expect(t("savedSearchCmd", { name: "Work" })).not.toContain("{name}");
  });
});

describe("strings", () => {
  test("defaults to English outside a Chinese locale", () => {
    expect(getLocale()).toBe("en");
    expect(strings().cmdkPlaceholder).toBe("Search files and content...");
  });
});

describe("Chinese locale", () => {
  const withLanguage = (language: string, run: () => void) => {
    const scope = globalThis as { testLanguage?: string };
    scope.testLanguage = language;
    try {
      run();
    } finally {
      delete scope.testLanguage;
    }
  };

  test("any zh variant selects Chinese", () => {
    withLanguage("zh-TW", () => expect(getLocale()).toBe("zh"));
  });

  test("t and strings switch language", () => {
    const english = t("exclusions");
    withLanguage("zh", () => {
      expect(t("exclusions")).not.toBe(english);
      expect(strings().cmdkPlaceholder).not.toBe("Search files and content...");
    });
  });

  test("every message exists in both languages", () => {
    withLanguage("zh", () => {
      const zh = Object.keys(strings()).sort();
      withLanguage("en", () => expect(Object.keys(strings()).sort()).toEqual(zh));
    });
  });
});

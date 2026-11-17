import { describe, expect, test } from "bun:test";
import { getLocale, strings } from "./i18n";

const withLanguage = <T>(language: string, run: () => T): T => {
  const scope = globalThis as { testLanguage?: string };
  scope.testLanguage = language;
  try {
    return run();
  } finally {
    delete scope.testLanguage;
  }
};

describe("English", () => {
  test("is the default outside a Chinese locale", () => {
    expect(getLocale()).toBe("en");
    expect(strings().cmdkPlaceholder).toBe("Search files and content...");
  });

  test("parameterised messages take their argument", () => {
    expect(strings().savedSearchCmd("Work")).toContain("Work");
  });
});

describe("Chinese locale", () => {
  test("any zh variant selects Chinese", () => {
    withLanguage("zh-TW", () => expect(getLocale()).toBe("zh"));
  });

  test("messages switch language", () => {
    const english = strings().exclusions;
    withLanguage("zh", () => {
      expect(strings().exclusions).not.toBe(english);
      expect(strings().cmdkPlaceholder).not.toBe("Search files and content...");
      expect(strings().savedSearchCmd("项目")).toContain("项目");
    });
  });

  test("every message exists in both languages", () => {
    const zh = withLanguage("zh", () => Object.keys(strings()).sort());
    expect(Object.keys(strings()).sort()).toEqual(zh);
  });

  test("no message is left untranslated", () => {
    const english = strings() as unknown as Record<string, unknown>;
    const chinese = withLanguage(
      "zh",
      () => strings() as unknown as Record<string, unknown>,
    );
    const untranslated = Object.keys(english).filter(
      (key) =>
        typeof english[key] === "string" && english[key] === chinese[key],
    );
    // Brand and key names (for example "Shift") legitimately match.
    expect(untranslated.length).toBeLessThan(10);
  });
});

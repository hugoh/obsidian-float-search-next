import { describe, expect, test } from "bun:test";
import type { TFile } from "obsidian";
import {
  buildNativeRegexQuery,
  compileQueryRegex,
  type FilterHost,
  isFileAllowed,
  matchAsSearchResult,
  textMatches,
} from "./filterBar";

function host(overrides: Partial<FilterHost["settings"]> = {}): FilterHost {
  return {
    settings: {
      filterIncludeBases: true,
      filterIncludeCanvas: true,
      filterStarredOnly: false,
      filterMatchCase: false,
      filterUseRegex: false,
      ...overrides,
    },
    saveSettings: async () => {},
    app: {} as FilterHost["app"],
  };
}
const asFile = (path: string) => ({ path, extension: path.split(".").pop() }) as TFile;

describe("isFileAllowed", () => {
  test("allows notes regardless of the type toggles", () => {
    expect(isFileAllowed(host({ filterIncludeBases: false, filterIncludeCanvas: false }), asFile("a.md"), null)).toBe(true);
  });

  test("honours the base and canvas toggles", () => {
    expect(isFileAllowed(host({ filterIncludeBases: false }), asFile("a.base"), null)).toBe(false);
    expect(isFileAllowed(host({ filterIncludeCanvas: false }), asFile("a.canvas"), null)).toBe(false);
    expect(isFileAllowed(host(), asFile("a.canvas"), null)).toBe(true);
  });

  test("starred-only restricts to bookmarked paths", () => {
    const bookmarks = new Set(["a.md"]);
    expect(isFileAllowed(host(), asFile("a.md"), bookmarks)).toBe(true);
    expect(isFileAllowed(host(), asFile("b.md"), bookmarks)).toBe(false);
  });
});

describe("compileQueryRegex", () => {
  test("is null unless regex mode is on", () => {
    expect(compileQueryRegex(host(), "a+")).toBeNull();
  });

  test("is null for an invalid pattern", () => {
    expect(compileQueryRegex(host({ filterUseRegex: true }), "(")).toBeNull();
  });

  test("ignores case unless match-case is on", () => {
    expect(compileQueryRegex(host({ filterUseRegex: true }), "a")?.flags).toBe("im");
    expect(compileQueryRegex(host({ filterUseRegex: true, filterMatchCase: true }), "a")?.flags).toBe("m");
  });
});

describe("buildNativeRegexQuery", () => {
  test("passes the query through outside regex mode", () => {
    expect(buildNativeRegexQuery(host(), "a/b")).toBe("a/b");
  });

  test("wraps the pattern for both content and path search", () => {
    expect(buildNativeRegexQuery(host({ filterUseRegex: true }), "a+")).toBe("/a+/ OR path:/a+/");
  });

  test("escapes slashes the native tokenizer would treat as delimiters", () => {
    expect(buildNativeRegexQuery(host({ filterUseRegex: true }), "a/b")).toBe("/a\\/b/ OR path:/a\\/b/");
  });

  test("an invalid pattern matches nothing", () => {
    expect(buildNativeRegexQuery(host({ filterUseRegex: true }), "(")).toBe("/(?!)/ OR path:/(?!)/");
  });
});

describe("matchAsSearchResult", () => {
  test("an empty query matches nothing", () => {
    expect(matchAsSearchResult(host(), "text", "  ")).toBeNull();
  });

  test("default mode is a case-insensitive fuzzy match", () => {
    expect(matchAsSearchResult(host(), "Hello World", "world")).not.toBeNull();
  });

  test("match-case mode is an exact, case-sensitive substring", () => {
    const h = host({ filterMatchCase: true });
    expect(matchAsSearchResult(h, "Hello World", "World")?.matches).toEqual([[6, 11]]);
    expect(matchAsSearchResult(h, "Hello World", "world")).toBeNull();
  });

  test("regex mode returns the first non-empty match range", () => {
    const h = host({ filterUseRegex: true });
    expect(matchAsSearchResult(h, "abc123def", "\\d+")?.matches).toEqual([[3, 6]]);
  });

  test("regex mode skips zero-width matches", () => {
    expect(matchAsSearchResult(host({ filterUseRegex: true }), "abc", "x*")).toBeNull();
  });

  test("regex mode respects case and multiline anchors", () => {
    expect(matchAsSearchResult(host({ filterUseRegex: true }), "one\nTWO", "^two$")).not.toBeNull();
    expect(matchAsSearchResult(host({ filterUseRegex: true, filterMatchCase: true }), "one\nTWO", "^two$")).toBeNull();
  });

  test("an invalid regex matches nothing", () => {
    expect(textMatches(host({ filterUseRegex: true }), "abc", "(")).toBe(false);
  });
});

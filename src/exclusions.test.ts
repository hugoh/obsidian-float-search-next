import { describe, expect, test } from "bun:test";
import {
  buildExcludeClause,
  isPathExcluded,
  normalizePath,
  stripExclusion,
  withExclusion,
} from "./exclusions";

const rules = { excludeFolders: ["Templates/", "/Archive"], excludeFiles: ["secrets.md"] };
const none = { excludeFolders: [], excludeFiles: [] };

describe("normalizePath", () => {
  test("trims whitespace and surrounding slashes", () => {
    expect(normalizePath("  /Templates/ ")).toBe("Templates");
    expect(normalizePath("a/b//")).toBe("a/b");
  });
});

describe("buildExcludeClause", () => {
  test("is empty without rules", () => {
    expect(buildExcludeClause(none)).toBe("");
  });

  test("excludes folders with a trailing slash and files exactly", () => {
    expect(buildExcludeClause(rules)).toBe(
      '-path:"Templates/" -path:"Archive/" -path:"secrets.md"',
    );
  });

  test("ignores blank entries", () => {
    expect(buildExcludeClause({ excludeFolders: ["  ", "/"], excludeFiles: [""] })).toBe("");
  });
});

describe("withExclusion", () => {
  test("returns the trimmed query when there are no rules", () => {
    expect(withExclusion(none, " hello ")).toBe("hello");
  });

  test("appends the clause after the query", () => {
    expect(withExclusion(rules, "hello")).toBe(`hello ${buildExcludeClause(rules)}`);
  });

  test("keeps a leading space for an empty query so text typed before it stays separate", () => {
    const withClause = withExclusion(rules, "");
    expect(withClause).toBe(` ${buildExcludeClause(rules)}`);
    expect(`pineapple${withClause}`).toBe(`pineapple ${buildExcludeClause(rules)}`);
  });

  test("an empty query round-trips to empty", () => {
    expect(stripExclusion(rules, withExclusion(rules, ""))).toBe("");
  });

  test("does not add the clause twice", () => {
    const once = withExclusion(rules, "hello");
    expect(withExclusion(rules, once)).toBe(once);
    const empty = withExclusion(rules, "");
    expect(withExclusion(rules, empty)).toBe(empty);
  });
});

describe("stripExclusion", () => {
  test("round-trips with withExclusion", () => {
    expect(stripExclusion(rules, withExclusion(rules, "hello world"))).toBe("hello world");
  });

  test("collapses whitespace left behind", () => {
    expect(stripExclusion(none, "  a   b ")).toBe("a b");
  });
});

describe("isPathExcluded", () => {
  test("excludes files in an excluded folder and the folder itself", () => {
    expect(isPathExcluded(rules, "Templates/daily.md", "daily.md")).toBe(true);
    expect(isPathExcluded(rules, "Archive", "Archive")).toBe(true);
  });

  test("does not match a folder by prefix only", () => {
    expect(isPathExcluded(rules, "Templates-old/a.md", "a.md")).toBe(false);
  });

  test("excludes a file by path or by name", () => {
    expect(isPathExcluded(rules, "secrets.md", "secrets.md")).toBe(true);
    expect(isPathExcluded(rules, "deep/secrets.md", "secrets.md")).toBe(true);
  });

  test("allows everything without rules", () => {
    expect(isPathExcluded(none, "any/thing.md", "thing.md")).toBe(false);
  });
});

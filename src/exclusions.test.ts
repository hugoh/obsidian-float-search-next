import { describe, expect, test } from "bun:test";
import {
  buildExcludeClause,
  createExclusionMatcher,
  normalizePath,
  stripExclusion,
  withExclusion,
} from "./exclusions";

const rules = {
  excludeFolders: ["Templates/", "/Archive"],
  excludeFiles: ["secrets.md"],
};
const none = { excludeFolders: [], excludeFiles: [] };

describe("normalizePath", () => {
  test("trims whitespace and surrounding slashes", () => {
    expect(normalizePath("  /Templates/ ")).toBe("Templates");
    expect(normalizePath("a/b//")).toBe("a/b");
  });

  test("the vault root normalises to nothing", () => {
    expect(normalizePath("/")).toBe("");
  });
});

describe("buildExcludeClause", () => {
  test("is empty without rules", () => {
    expect(buildExcludeClause(none)).toBe("");
  });

  test("anchors folders at the start and files at both ends", () => {
    expect(buildExcludeClause(rules)).toBe(
      "-path:/^Templates\\// -path:/^Archive\\// -path:/^secrets\\.md$/",
    );
  });

  test("ignores blank entries", () => {
    expect(
      buildExcludeClause({ excludeFolders: ["  ", "/"], excludeFiles: [""] }),
    ).toBe("");
  });

  test("cannot be broken out of by quotes or regex characters in a name", () => {
    const clause = buildExcludeClause({
      excludeFolders: ['a" -path:"b', "c(d)+"],
      excludeFiles: [],
    });
    expect(clause.split(" ")).toHaveLength(2);
    expect(clause).toContain("c\\(d\\)\\+");
  });
});

describe("withExclusion", () => {
  test("returns the trimmed query when there are no rules", () => {
    expect(withExclusion(none, " hello ")).toBe("hello");
  });

  test("appends the clause after the query", () => {
    expect(withExclusion(rules, "hello")).toBe(
      `hello ${buildExcludeClause(rules)}`,
    );
  });

  test("keeps a leading space for an empty query so text typed before it stays separate", () => {
    const withClause = withExclusion(rules, "");
    expect(withClause).toBe(` ${buildExcludeClause(rules)}`);
    expect(`pineapple${withClause}`).toBe(
      `pineapple ${buildExcludeClause(rules)}`,
    );
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
    expect(stripExclusion(rules, withExclusion(rules, "hello world"))).toBe(
      "hello world",
    );
  });

  test("collapses whitespace left behind", () => {
    expect(stripExclusion(none, "  a   b ")).toBe("a b");
  });
});

describe("createExclusionMatcher", () => {
  const excluded = createExclusionMatcher(rules);

  test("excludes files inside an excluded folder", () => {
    expect(excluded("Templates/daily.md")).toBe(true);
    expect(excluded("Archive/2020/x.md")).toBe(true);
  });

  test("excludes only the folder itself, not look-alikes or nested namesakes", () => {
    expect(excluded("Templates-old/a.md")).toBe(false);
    expect(excluded("Work/Archive/a.md")).toBe(false);
  });

  test("excludes a file by its exact path only", () => {
    expect(excluded("secrets.md")).toBe(true);
    expect(excluded("deep/secrets.md")).toBe(false);
    expect(excluded("my-secrets.md")).toBe(false);
  });

  test("allows everything without rules", () => {
    expect(createExclusionMatcher(none)("any/thing.md")).toBe(false);
  });
});

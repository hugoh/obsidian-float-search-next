import { describe, expect, test } from "bun:test";
import {
  anyUnitHasAllTerms,
  parseTerms,
  splitBlocks,
  splitLines,
  splitSections,
} from "./sameUnit";

describe("parseTerms", () => {
  test("splits on whitespace and lowercases", () => {
    expect(parseTerms("Foo  BAR")).toEqual(["foo", "bar"]);
  });

  test("ignores a surrounding pair of parentheses", () => {
    expect(parseTerms("(foo bar)")).toEqual(["foo", "bar"]);
  });

  test("keeps a quoted phrase as one term", () => {
    expect(parseTerms('"two words" x')).toEqual(["two words", "x"]);
    expect(parseTerms('("two words" x)')).toEqual(["two words", "x"]);
  });

  test("is empty for blank input", () => {
    expect(parseTerms("")).toEqual([]);
    expect(parseTerms("  ()  ")).toEqual([]);
  });
});

describe("splitLines", () => {
  test("splits on newlines, including Windows ones", () => {
    expect(splitLines("a\r\nb\nc")).toEqual(["a", "b", "c"]);
  });
});

describe("splitBlocks", () => {
  test("paragraphs are separated by blank lines", () => {
    expect(splitBlocks("a\nb\n\nc")).toEqual(["a\nb", "c"]);
  });

  test("each list item is its own block, with its continuation lines", () => {
    expect(splitBlocks("- one\n- two\n  more\n1. three")).toEqual([
      "- one",
      "- two\n  more",
      "1. three",
    ]);
  });

  test("a heading is its own block", () => {
    expect(splitBlocks("# Title\ntext")).toEqual(["# Title", "text"]);
  });

  test("ignores extra blank lines", () => {
    expect(splitBlocks("\n\na\n\n\n\nb\n\n")).toEqual(["a", "b"]);
  });
});

describe("splitSections", () => {
  test("a new section starts at every heading", () => {
    expect(splitSections("intro\n# A\nx\n## B\ny")).toEqual([
      "intro",
      "# A\nx",
      "## B\ny",
    ]);
  });

  test("a note without headings is one section", () => {
    expect(splitSections("just text\nmore")).toEqual(["just text\nmore"]);
  });

  test("an empty note has no sections", () => {
    expect(splitSections("")).toEqual([]);
  });
});

describe("anyUnitHasAllTerms", () => {
  const units = ["Alpha beta", "gamma"];

  test("is true when one unit contains every term", () => {
    expect(anyUnitHasAllTerms(units, ["alpha", "beta"])).toBe(true);
  });

  test("is false when the terms are spread over different units", () => {
    expect(anyUnitHasAllTerms(units, ["alpha", "gamma"])).toBe(false);
  });

  test("is false without terms", () => {
    expect(anyUnitHasAllTerms(units, [])).toBe(false);
  });

  test("matches case-insensitively and by substring", () => {
    expect(anyUnitHasAllTerms(units, ["ALPHA"])).toBe(true);
  });
});

import { describe, expect, test } from "bun:test";
import {
  compileSafeRegex,
  escapeRegex,
  MAX_REGEX_SOURCE,
  MAX_SEARCHED_TEXT,
  truncateForRegex,
} from "./regex";

describe("escapeRegex", () => {
  test("escapes every metacharacter and the slash delimiter", () => {
    const raw = ".*+?^${}()|[]\\/";
    expect(new RegExp(`^${escapeRegex(raw)}$`).test(raw)).toBe(true);
    expect(escapeRegex("a/b")).toBe("a\\/b");
  });

  test("leaves plain text untouched", () => {
    expect(escapeRegex("hello_1")).toBe("hello_1");
  });

  test("encodes spaces so the term stays one token", () => {
    expect(escapeRegex("a b")).toBe("a\\x20b");
    expect(new RegExp(`^${escapeRegex("a b")}$`).test("a b")).toBe(true);
  });
});

describe("compileSafeRegex", () => {
  test("compiles an ordinary pattern with the requested flags", () => {
    const re = compileSafeRegex("a+b", "im");
    expect(re?.flags).toBe("im");
    expect(re?.test("xAAb")).toBe(true);
  });

  test("rejects invalid syntax", () => {
    expect(compileSafeRegex("(", "i")).toBeNull();
  });

  test.each(["^(a+)+$", "(a*)*b", "(x+x+)+y"])(
    "rejects nested quantifiers: %s",
    (pattern) => {
      expect(compileSafeRegex(pattern, "i")).toBeNull();
    },
  );

  test("rejects patterns longer than the limit", () => {
    expect(compileSafeRegex("a".repeat(MAX_REGEX_SOURCE + 1), "i")).toBeNull();
    expect(compileSafeRegex("a".repeat(MAX_REGEX_SOURCE), "i")).not.toBeNull();
  });

  test("accepts the common safe shapes", () => {
    for (const pattern of [
      "^\\d+$",
      "foo|bar",
      "(foo|bar)+",
      "a{1,5}b",
      "[a-z]+@[a-z]+\\.com",
    ]) {
      expect(compileSafeRegex(pattern, "i")).not.toBeNull();
    }
  });
});

describe("truncateForRegex", () => {
  test("returns short text unchanged", () => {
    expect(truncateForRegex("short")).toBe("short");
  });

  test("bounds the text a regex will see", () => {
    expect(truncateForRegex("x".repeat(MAX_SEARCHED_TEXT + 10)).length).toBe(
      MAX_SEARCHED_TEXT,
    );
  });
});

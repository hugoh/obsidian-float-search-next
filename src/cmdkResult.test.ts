import { describe, expect, test } from "bun:test";
import type { TFile } from "obsidian";
import { type CmdkResult, ephemeralStateFor, isFileResult } from "./cmdkResult";

const file = { path: "a.md" } as TFile;
const base = { file, nameMatch: null, pathMatch: null };

describe("isFileResult", () => {
  test("is true for results that point at a file", () => {
    const results: CmdkResult[] = [
      { ...base, type: "file" },
      { ...base, type: "heading", heading: "H", headingMatch: null },
      { ...base, type: "content", content: "c", contentMatch: null, line: 3 },
    ];
    expect(results.every(isFileResult)).toBe(true);
  });

  test("is false for the create and save rows", () => {
    expect(isFileResult({ type: "create", createQuery: "x" })).toBe(false);
    expect(isFileResult({ type: "save" })).toBe(false);
    expect(isFileResult({ type: "notice", message: "m" })).toBe(false);
  });
});

describe("ephemeralStateFor", () => {
  test("a plain file has no target position", () => {
    expect(ephemeralStateFor({ ...base, type: "file" })).toBeUndefined();
  });

  test("a heading jumps to its subpath", () => {
    expect(
      ephemeralStateFor({
        ...base,
        type: "heading",
        heading: "Intro",
        headingMatch: null,
      }),
    ).toEqual({
      subpath: "#Intro",
    });
  });

  test("content jumps to its line, including line zero", () => {
    expect(
      ephemeralStateFor({
        ...base,
        type: "content",
        content: "c",
        contentMatch: null,
        line: 0,
      }),
    ).toEqual({
      line: 0,
    });
    expect(
      ephemeralStateFor({
        ...base,
        type: "content",
        content: "c",
        contentMatch: null,
        line: 12,
      }),
    ).toEqual({
      line: 12,
    });
  });
});

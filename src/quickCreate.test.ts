import { describe, expect, test } from "bun:test";
import { safeFileName, uniqueNotePath } from "./quickCreate";

const taken =
  (...paths: string[]) =>
  (path: string) =>
    paths.includes(path);

describe("uniqueNotePath", () => {
  test("puts the note in the vault root for an empty folder", () => {
    expect(uniqueNotePath("", "20240101", taken())).toBe("20240101.md");
    expect(uniqueNotePath("/", "20240101", taken())).toBe("20240101.md");
  });

  test("puts the note in the folder, normalising slashes", () => {
    expect(uniqueNotePath("Inbox/", "t", taken())).toBe("Inbox/t.md");
    expect(uniqueNotePath("/Inbox", "t", taken())).toBe("Inbox/t.md");
  });

  test("adds a counter when the name is taken", () => {
    expect(uniqueNotePath("Inbox", "t", taken("Inbox/t.md"))).toBe(
      "Inbox/t 1.md",
    );
    expect(
      uniqueNotePath(
        "Inbox",
        "t",
        taken("Inbox/t.md", "Inbox/t 1.md", "Inbox/t 2.md"),
      ),
    ).toBe("Inbox/t 3.md");
  });
});

describe("safeFileName", () => {
  test("replaces characters that are not allowed in file names", () => {
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j");
  });

  test("keeps ordinary and non-Latin text", () => {
    expect(safeFileName("笔记 2024-01-01")).toBe("笔记 2024-01-01");
  });

  test("never returns an empty name", () => {
    expect(safeFileName("   ")).toBe("Untitled");
  });
});

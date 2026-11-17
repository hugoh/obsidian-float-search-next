import { describe, expect, test } from "bun:test";
import { noteNameFromText, safeFileName, uniqueNotePath } from "./quickCreate";

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

  test("uses the given fallback, so the name can be localised", () => {
    expect(safeFileName("   ", "未命名")).toBe("未命名");
    expect(safeFileName("///", "未命名")).toBe("---");
  });
});

describe("noteNameFromText", () => {
  test("keeps ordinary text, including non-Latin text", () => {
    expect(noteNameFromText("hello world")).toBe("hello world");
    expect(noteNameFromText("笔记 想法")).toBe("笔记 想法");
  });

  test("replaces characters that are not allowed in file names", () => {
    expect(noteNameFromText("a/b:c")).toBe("a-b-c");
  });

  test("replaces characters that Obsidian reads as link syntax", () => {
    expect(noteNameFromText("a#b^c[d]e")).toBe("a-b-c-d-e");
  });

  test("drops leading dots so the note is not hidden", () => {
    expect(noteNameFromText(".hidden")).toBe("hidden");
  });

  test("is null when nothing usable is left", () => {
    expect(noteNameFromText("   ")).toBeNull();
    expect(noteNameFromText("...")).toBeNull();
    expect(noteNameFromText("")).toBeNull();
  });

  test("limits the length", () => {
    expect(noteNameFromText("x".repeat(500))?.length).toBe(100);
  });
});

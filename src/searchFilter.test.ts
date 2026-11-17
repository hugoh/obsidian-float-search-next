import { describe, expect, test } from "bun:test";
import type { App, CachedMetadata, TFile } from "obsidian";
import {
  freeText,
  isPlainText,
  parseQuery,
  requiresContent,
  SearchFilter,
} from "./searchFilter";

function file(path: string): TFile {
  const name = path.split("/").pop() ?? path;
  const parentPath = path.includes("/")
    ? path.slice(0, path.lastIndexOf("/"))
    : "";
  return {
    path,
    name,
    basename: name.replace(/\.[^.]+$/, ""),
    parent: { path: parentPath },
  } as unknown as TFile;
}

const filter = new SearchFilter({
  metadataCache: { getFileCache: () => null },
} as unknown as App);
const tagged = (...tags: string[]): CachedMetadata =>
  ({ tags: tags.map((tag) => ({ tag })) }) as unknown as CachedMetadata;

describe("parseQuery", () => {
  test("an empty query has no groups", () => {
    expect(parseQuery("   ")).toEqual({ groups: [] });
  });

  test("space separates AND clauses and OR separates groups", () => {
    const q = parseQuery("tag:a path:b OR tag:c");
    expect(q.groups.map((g) => g.length)).toEqual([2, 1]);
  });

  test("normalises tags to start with a hash", () => {
    expect(parseQuery("tag:project").groups[0]?.[0]).toMatchObject({
      kind: "tag",
      tag: "#project",
    });
    expect(parseQuery("tag:#project").groups[0]?.[0]).toMatchObject({
      tag: "#project",
    });
  });

  test("a leading dash negates a clause", () => {
    expect(parseQuery("-path:Archive").groups[0]?.[0]).toMatchObject({
      kind: "path",
      value: "Archive",
      negated: true,
    });
  });

  test("quoted phrases stay one free-text clause", () => {
    expect(parseQuery('"hello world"').groups[0]).toEqual([
      { kind: "text", value: "hello world", negated: false, quoted: true },
    ]);
  });

  test.each([
    ["[status::done]", "status", "done"],
    ["prop:status:done", "status", "done"],
    ["property:status:done", "status", "done"],
    ["status::done", "status", "done"],
  ])("understands the property form %s", (raw, key, value) => {
    expect(parseQuery(raw).groups[0]?.[0]).toMatchObject({
      kind: "property",
      key,
      value,
    });
  });

  test("a property without a value only tests existence", () => {
    expect(parseQuery("[status::]").groups[0]?.[0]).toMatchObject({
      key: "status",
      value: undefined,
    });
  });

  test("operator names are case-insensitive and aliased", () => {
    expect(parseQuery("FILE:notes").groups[0]?.[0]).toMatchObject({
      kind: "name",
      value: "notes",
    });
    expect(parseQuery("tags:x").groups[0]?.[0]).toMatchObject({ kind: "tag" });
  });

  test("a bare dash is ignored", () => {
    expect(parseQuery("-")).toEqual({ groups: [] });
  });
});

describe("requiresContent", () => {
  test.each(["line:a", "block:a", "section:a", "content:a", "task:"])(
    "%s needs the file body",
    (raw) => expect(requiresContent(parseQuery(raw))).toBe(true),
  );

  test("metadata and free text do not", () => {
    expect(requiresContent(parseQuery("tag:a path:b hello"))).toBe(false);
  });
});

describe("SearchFilter.matchMetadata", () => {
  const match = (raw: string, path: string, cache?: CachedMetadata) =>
    filter.matchMetadata(file(path), parseQuery(raw), cache ?? null);

  test("an empty query matches everything", () => {
    expect(match("", "a.md")).toBe(true);
  });

  test("path is a case-insensitive substring", () => {
    expect(match("path:notes/daily", "Notes/Daily/2024.md")).toBe(true);
    expect(match("path:work", "Notes/a.md")).toBe(false);
  });

  test("folder tests the parent folder only", () => {
    expect(match("folder:Notes", "Notes/a.md")).toBe(true);
    expect(match("folder:a.md", "Notes/a.md")).toBe(false);
  });

  test("file matches the name or the exact basename", () => {
    expect(match("file:2024", "Notes/2024-01.md")).toBe(true);
    expect(match("file:zzz", "Notes/2024-01.md")).toBe(false);
  });

  test("negation inverts a clause", () => {
    expect(match("-path:Archive", "Archive/a.md")).toBe(false);
    expect(match("-path:Archive", "Notes/a.md")).toBe(true);
  });

  test("tags match nested tags", () => {
    expect(match("tag:project", "a.md", tagged("#project/alpha"))).toBe(true);
    expect(match("tag:project", "a.md", tagged("#projects"))).toBe(false);
  });

  test("tags in the tags property count, with or without a hash", () => {
    const listed = {
      frontmatter: { tags: ["work", "#project"] },
    } as unknown as CachedMetadata;
    expect(match("tag:project", "a.md", listed)).toBe(true);
    const text = {
      frontmatter: { tags: "work, project" },
    } as unknown as CachedMetadata;
    expect(match("tag:project", "a.md", text)).toBe(true);
  });

  test("other properties are not tags", () => {
    const cache = {
      frontmatter: { category: "project", topics: ["project"] },
    } as unknown as CachedMetadata;
    expect(match("tag:project", "a.md", cache)).toBe(false);
  });

  test("tags are case-insensitive", () => {
    expect(match("tag:Project", "a.md", tagged("#project"))).toBe(true);
  });

  test("a note without metadata has no tags", () => {
    expect(match("tag:project", "a.md")).toBe(false);
  });

  test("properties match by existence and by substring value", () => {
    const cache = {
      frontmatter: { status: "In Progress" },
    } as unknown as CachedMetadata;
    expect(match("[status::]", "a.md", cache)).toBe(true);
    expect(match("[status::progress]", "a.md", cache)).toBe(true);
    expect(match("[status::done]", "a.md", cache)).toBe(false);
    expect(match("[owner::]", "a.md", cache)).toBe(false);
  });

  test("AND within a group, OR across groups", () => {
    expect(match("tag:a path:Notes", "Notes/x.md", tagged("#a"))).toBe(true);
    expect(match("tag:a path:Work", "Notes/x.md", tagged("#a"))).toBe(false);
    expect(
      match("tag:a path:Work OR path:Notes", "Notes/x.md", tagged("#a")),
    ).toBe(true);
  });

  test("content clauses and free text never pre-filter a file out", () => {
    expect(match("content:needle hello", "a.md")).toBe(true);
  });
});

describe("SearchFilter.matchContent", () => {
  const match = (raw: string, body: string, cache?: CachedMetadata) =>
    filter.matchContent(file("a.md"), body, parseQuery(raw), cache ?? null);

  test("content looks in the body case-insensitively", () => {
    expect(match("content:needle", "a NEEDLE here")).toBe(true);
    expect(match("content:needle", "nothing")).toBe(false);
  });

  test("line matches within a single line", () => {
    expect(match("line:foo", "foo bar\nbaz")).toBe(true);
    expect(match("line:foo", "foa\nbar")).toBe(false);
  });

  test("block matches a block reference id", () => {
    expect(match("block:abc", "text ^abc")).toBe(true);
    expect(match("block:abc", "text abc")).toBe(false);
  });

  test("task matches checkbox lines, optionally by text", () => {
    expect(match("task:", "- [ ] one")).toBe(true);
    expect(match("task:one", "- [x] one")).toBe(true);
    expect(match("task:two", "- [ ] one")).toBe(false);
    expect(match("task:", "- plain")).toBe(false);
  });

  test("section matches headings from the metadata cache", () => {
    const cache = {
      headings: [{ heading: "Meeting Notes" }],
    } as unknown as CachedMetadata;
    expect(match("section:meeting", "x", cache)).toBe(true);
    expect(match("section:other", "x", cache)).toBe(false);
  });

  test("negated content excludes files that contain it", () => {
    expect(match("-content:secret", "has secret")).toBe(false);
    expect(match("-content:secret", "clean")).toBe(true);
  });
});

describe("SearchFilter.buildMatchSets", () => {
  test("returns the matching paths per filter", () => {
    const files = [file("Notes/a.md"), file("Work/b.md")];
    const sets = filter.buildMatchSets(files, ["path:Notes", "path:Work"]);
    expect([...(sets.get("path:Notes") ?? [])]).toEqual(["Notes/a.md"]);
    expect([...(sets.get("path:Work") ?? [])]).toEqual(["Work/b.md"]);
  });
});

describe("freeText", () => {
  test("joins the positive free-text terms", () => {
    expect(freeText(parseQuery("hello tag:a world"))).toBe("hello world");
  });

  test("ignores negated terms and operators", () => {
    expect(freeText(parseQuery("-secret path:x content:y"))).toBe("");
  });

  test("keeps a quoted phrase as one term", () => {
    expect(freeText(parseQuery('"two words" other'))).toBe("two words other");
  });

  test("is empty for an empty query", () => {
    expect(freeText(parseQuery(""))).toBe("");
  });
});

describe("isPlainText", () => {
  test("is true only when every clause is a positive free-text term", () => {
    expect(isPlainText(parseQuery("hello world"))).toBe(true);
    expect(isPlainText(parseQuery("hello tag:a"))).toBe(false);
    expect(isPlainText(parseQuery("-hello"))).toBe(false);
    expect(isPlainText(parseQuery("a OR b"))).toBe(true);
  });
});

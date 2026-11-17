import { describe, expect, test } from "bun:test";
import type { App, CachedMetadata, TFile } from "obsidian";
import {
  firstMatchLine,
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

  test("line needs every term on one line", () => {
    expect(match("line:foo", "foo bar\nbaz")).toBe(true);
    expect(match("line:(foo bar)", "foo and bar\nbaz")).toBe(true);
    expect(match("line:(foo baz)", "foo bar\nbaz")).toBe(false);
  });

  test("block needs every term in one block, like Obsidian", () => {
    const body = "alpha beta\ngamma\n\ndelta";
    expect(match("block:(alpha gamma)", body)).toBe(true);
    expect(match("block:(alpha delta)", body)).toBe(false);
    expect(match("block:alpha", body)).toBe(true);
  });

  test("each list item is its own block", () => {
    expect(match("block:(one two)", "- one\n- two")).toBe(false);
    expect(match("block:(one two)", "- one two\n- three")).toBe(true);
  });

  test("a single term is matched as plain text, reference ids included", () => {
    expect(match("block:abc", "text ^abc")).toBe(true);
    expect(match("block:(text xyz)", "text ^abc")).toBe(false);
  });

  test("section needs every term between the same two headings", () => {
    const body = "intro\n# One\nalpha\n\nbeta\n# Two\ngamma";
    expect(match("section:(alpha beta)", body)).toBe(true);
    expect(match("section:(alpha gamma)", body)).toBe(false);
    expect(match("section:(intro alpha)", body)).toBe(false);
  });

  test("a quoted phrase must appear as written", () => {
    expect(match('block:("two words" x)', "two words x")).toBe(true);
    expect(match('block:("two words" x)', "two other words x")).toBe(false);
  });

  test("negated line, block and section exclude notes that match", () => {
    expect(match("-block:(alpha beta)", "alpha beta")).toBe(false);
    expect(match("-section:(alpha beta)", "alpha\n# H\nbeta")).toBe(true);
  });

  test("task matches checkbox lines, optionally by text", () => {
    expect(match("task:", "- [ ] one")).toBe(true);
    expect(match("task:one", "- [x] one")).toBe(true);
    expect(match("task:two", "- [ ] one")).toBe(false);
    expect(match("task:", "- plain")).toBe(false);
  });

  test("negated content excludes files that contain it", () => {
    expect(match("-content:secret", "has secret")).toBe(false);
    expect(match("-content:secret", "clean")).toBe(true);
  });
});

describe("grouped operator values", () => {
  test("parseQuery keeps parenthesised terms together as one clause", () => {
    expect(parseQuery("block:(foo bar) tag:x").groups[0]).toEqual([
      { kind: "block", value: "foo bar", negated: false },
      { kind: "tag", tag: "#x", negated: false, quoted: false },
    ]);
  });

  test("a single term needs no parentheses", () => {
    expect(parseQuery("section:foo").groups[0]?.[0]).toMatchObject({
      kind: "section",
      value: "foo",
    });
  });

  test("toNativeQuery restores the parentheses", () => {
    expect(filter.toNativeQuery("block:(foo bar)")).toBe("block:(foo bar)");
    expect(filter.toNativeQuery("-line:(a b) section:c")).toBe(
      "-line:(a b) section:c",
    );
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

describe("firstMatchLine", () => {
  const text = "intro\nalpha here\nbeta there\n";

  test("finds the first line containing a term of a content clause", () => {
    expect(firstMatchLine(text, parseQuery("content:beta"))).toEqual({
      line: 2,
      text: "beta there",
    });
  });

  test("uses every term of a grouped clause", () => {
    expect(firstMatchLine(text, parseQuery("block:(beta alpha)"))).toEqual({
      line: 1,
      text: "alpha here",
    });
  });

  test("ignores negated clauses", () => {
    expect(
      firstMatchLine(text, parseQuery("-content:alpha content:beta")),
    ).toEqual({
      line: 2,
      text: "beta there",
    });
  });

  test("falls back to the first non-empty line", () => {
    expect(
      firstMatchLine("\n\n  first  \nsecond", parseQuery("content:zzz")),
    ).toEqual({
      line: 2,
      text: "first",
    });
  });

  test("an empty note has no line", () => {
    expect(firstMatchLine("", parseQuery("content:x"))).toEqual({
      line: 0,
      text: "",
    });
  });
});

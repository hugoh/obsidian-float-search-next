import { mock } from "bun:test";

const fuzzy = (query: string) => (text: string) => {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  return index < 0
    ? null
    : { score: 0, matches: [[index, index + query.length]] };
};

mock.module("obsidian", () => ({
  prepareFuzzySearch: fuzzy,
  TFile: class {},
  addIcon: () => {},
  setIcon: () => {},
  // Mirrors Obsidian's getAllTags: inline tags plus the `tags` frontmatter property.
  getAllTags: (cache: {
    tags?: { tag: string }[];
    frontmatter?: Record<string, unknown>;
  }) => {
    const fromBody = (cache.tags ?? []).map((entry) => entry.tag);
    const raw = cache.frontmatter?.tags;
    const list = Array.isArray(raw)
      ? raw
      : typeof raw === "string"
        ? raw.split(/[\s,]+/)
        : [];
    const fromFrontmatter = list
      .filter((tag): tag is string => typeof tag === "string" && tag.length > 0)
      .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));
    return [...fromBody, ...fromFrontmatter];
  },
  normalizePath: (path: string) =>
    path
      .replace(/\\/g, "/")
      .replace(/\/+/g, "/")
      .replace(/^\/|\/$/g, "") || "/",
  getLanguage: () =>
    (globalThis as { testLanguage?: string }).testLanguage ?? "en",
  requireApiVersion: () => true,
  debounce: (fn: () => void) => fn,
}));

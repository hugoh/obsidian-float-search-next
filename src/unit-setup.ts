import { mock } from "bun:test";
import { testLanguage } from "./test-language";

const fuzzy = (query: string) => (text: string) => {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  return index < 0
    ? null
    : { score: 0, matches: [[index, index + query.length]] };
};

void mock.module("obsidian", () => ({
  prepareFuzzySearch: fuzzy,
  // Exact words, all required: scored 2 so tests can tell it from fuzzy (0) and regex (1).
  prepareSimpleSearch: (query: string) => (text: string) => {
    const lower = text.toLowerCase();
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches: [number, number][] = [];
    for (const word of words) {
      const index = lower.indexOf(word);
      if (index < 0) return null;
      matches.push([index, index + word.length]);
    }
    return { score: 2, matches };
  },

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
  getLanguage: () => testLanguage.current ?? "en",
  requireApiVersion: () => true,
  debounce: (fn: () => void) => fn,
}));

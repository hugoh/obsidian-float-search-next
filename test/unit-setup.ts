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
  normalizePath: (path: string) =>
    path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "") || "/",
  getLanguage: () => (globalThis as { testLanguage?: string }).testLanguage ?? "en",
  requireApiVersion: () => true,
  debounce: (fn: () => void) => fn,
}));

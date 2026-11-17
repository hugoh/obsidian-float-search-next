import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SETTINGS,
  newSavedSearchId,
  parseViewType,
  sanitizeSettings,
} from "./settings";

describe("sanitizeSettings", () => {
  test.each([[null], [undefined], [42], ["text"], [[]]])(
    "falls back to the defaults for %p",
    (raw) => {
      expect(sanitizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
    },
  );

  test("keeps valid values", () => {
    const settings = sanitizeSettings({
      showFilePath: true,
      defaultViewType: "tab",
      cmdkTriggerKey: "Alt",
      cmdkDoubleTapInterval: 400,
      cmdkQuickCreateFolder: "Inbox",
      excludeFolders: ["Archive"],
    });
    expect(settings).toMatchObject({
      showFilePath: true,
      defaultViewType: "tab",
      cmdkTriggerKey: "Alt",
      cmdkDoubleTapInterval: 400,
      cmdkQuickCreateFolder: "Inbox",
      excludeFolders: ["Archive"],
    });
  });

  test("replaces values of the wrong type or outside the allowed set", () => {
    const settings = sanitizeSettings({
      showFilePath: "yes",
      defaultViewType: "hologram",
      cmdkTriggerKey: "Hyper",
      cmdkDoubleTapInterval: "fast",
      excludeFolders: "Archive",
      cmdkQuickCreateFolder: 7,
    });
    expect(settings.showFilePath).toBe(DEFAULT_SETTINGS.showFilePath);
    expect(settings.defaultViewType).toBe(DEFAULT_SETTINGS.defaultViewType);
    expect(settings.cmdkTriggerKey).toBe(DEFAULT_SETTINGS.cmdkTriggerKey);
    expect(settings.cmdkDoubleTapInterval).toBe(
      DEFAULT_SETTINGS.cmdkDoubleTapInterval,
    );
    expect(settings.excludeFolders).toEqual([]);
    expect(settings.cmdkQuickCreateFolder).toBe("");
  });

  test("previews quick-search results automatically by default, and honours the choice", () => {
    expect(DEFAULT_SETTINGS.cmdkAutoPreview).toBe(true);
    expect(sanitizeSettings({ cmdkAutoPreview: false }).cmdkAutoPreview).toBe(
      false,
    );
    expect(sanitizeSettings({ cmdkAutoPreview: "no" }).cmdkAutoPreview).toBe(
      true,
    );
  });

  test("clamps the double-tap interval to the range the slider allows", () => {
    expect(
      sanitizeSettings({ cmdkDoubleTapInterval: 5 }).cmdkDoubleTapInterval,
    ).toBe(150);
    expect(
      sanitizeSettings({ cmdkDoubleTapInterval: 99999 }).cmdkDoubleTapInterval,
    ).toBe(600);
  });

  test("keeps only string entries in the exclusion lists", () => {
    expect(
      sanitizeSettings({ excludeFiles: ["a.md", 3, null, "b.md"] })
        .excludeFiles,
    ).toEqual(["a.md", "b.md"]);
  });

  test("never shares the default arrays", () => {
    const settings = sanitizeSettings({});
    settings.excludeFolders.push("x");
    settings.savedSearches.push({ id: "1", name: "n", query: "q" });
    expect(DEFAULT_SETTINGS.excludeFolders).toEqual([]);
    expect(DEFAULT_SETTINGS.savedSearches).toEqual([]);
  });

  test("never restores a saved query, whatever data.json holds", () => {
    expect(
      sanitizeSettings({ searchViewState: { query: "secret" } }).searchViewState
        .query,
    ).toBe("");
  });

  test("merges the saved search view state with its defaults", () => {
    const settings = sanitizeSettings({
      searchViewState: { collapseAll: true, sortOrder: "nonsense", query: 5 },
    });
    expect(settings.searchViewState.collapseAll).toBe(true);
    expect(settings.searchViewState.sortOrder).toBe(
      DEFAULT_SETTINGS.searchViewState.sortOrder,
    );
    expect(settings.searchViewState.query).toBe("");
  });
});

describe("saved searches", () => {
  test("drops malformed entries", () => {
    const settings = sanitizeSettings({
      savedSearches: [
        { name: "ok", query: "tag:a" },
        { name: "", query: "x" },
        { name: "n" },
        null,
        "str",
      ],
    });
    expect(settings.savedSearches.map((s) => s.name)).toEqual(["ok"]);
  });

  test("gives entries without an id a unique one", () => {
    const settings = sanitizeSettings({
      savedSearches: [
        { name: "a", query: "1" },
        { name: "b", query: "2" },
      ],
    });
    const ids = settings.savedSearches.map((s) => s.id);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(
      true,
    );
    expect(new Set(ids).size).toBe(2);
  });

  test("keeps existing ids and repairs duplicates", () => {
    const settings = sanitizeSettings({
      savedSearches: [
        { id: "same", name: "a", query: "1" },
        { id: "same", name: "b", query: "2" },
        { id: "other", name: "c", query: "3" },
      ],
    });
    const ids = settings.savedSearches.map((s) => s.id);
    expect(ids[0]).toBe("same");
    expect(ids[2]).toBe("other");
    expect(new Set(ids).size).toBe(3);
  });

  test("names in any script are kept intact", () => {
    expect(
      sanitizeSettings({
        savedSearches: [{ name: "项目笔记", query: "tag:项目" }],
      }).savedSearches[0]?.name,
    ).toBe("项目笔记");
  });

  test("generated ids differ", () => {
    expect(newSavedSearchId()).not.toBe(newSavedSearchId());
  });
});

describe("parseViewType", () => {
  test.each(["modal", "sidebar", "split", "tab", "window"])(
    "accepts %s",
    (type) => {
      expect(parseViewType(type)).toBe(type);
    },
  );

  test.each(["", "popup", "TAB", undefined, null, 3, "tab "])(
    "rejects %p",
    (type) => {
      expect(parseViewType(type)).toBeUndefined();
    },
  );
});

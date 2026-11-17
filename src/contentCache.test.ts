import { describe, expect, test } from "bun:test";
import { ContentCache } from "./contentCache";

describe("ContentCache", () => {
  test("returns what was stored while the modification time matches", () => {
    const cache = new ContentCache();
    cache.set("a.md", 1, "hello");
    expect(cache.get("a.md", 1)).toBe("hello");
  });

  test("treats a changed modification time as a miss and forgets the entry", () => {
    const cache = new ContentCache();
    cache.set("a.md", 1, "hello");
    expect(cache.get("a.md", 2)).toBeUndefined();
    expect(cache.get("a.md", 1)).toBeUndefined();
  });

  test("evicts the least recently used entry when over the entry limit", () => {
    const cache = new ContentCache({ maxEntries: 2, maxBytes: 1_000_000 });
    cache.set("a", 1, "1");
    cache.set("b", 1, "2");
    cache.get("a", 1);
    cache.set("c", 1, "3");
    expect(cache.get("b", 1)).toBeUndefined();
    expect(cache.get("a", 1)).toBe("1");
    expect(cache.get("c", 1)).toBe("3");
  });

  test("evicts by size, not just count", () => {
    const cache = new ContentCache({ maxEntries: 100, maxBytes: 60 });
    cache.set("a", 1, "x".repeat(20));
    cache.set("b", 1, "y".repeat(20));
    expect(cache.get("a", 1)).toBeUndefined();
    expect(cache.get("b", 1)).toBe("y".repeat(20));
  });

  test("does not keep a single text larger than the whole budget", () => {
    const cache = new ContentCache({ maxEntries: 10, maxBytes: 100 });
    cache.set("big", 1, "z".repeat(500));
    expect(cache.get("big", 1)).toBeUndefined();
    expect(cache.bytes).toBe(0);
  });

  test("tracks bytes through replace, delete and clear", () => {
    const cache = new ContentCache();
    cache.set("a", 1, "abcd");
    const first = cache.bytes;
    cache.set("a", 2, "abcd");
    expect(cache.bytes).toBe(first);
    cache.delete("a");
    expect(cache.bytes).toBe(0);
    cache.set("b", 1, "x");
    cache.clear();
    expect(cache.bytes).toBe(0);
    expect(cache.size).toBe(0);
  });
});

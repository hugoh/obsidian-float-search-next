import safeRegex from "safe-regex2";

export const MAX_REGEX_SOURCE = 200;
export const MAX_SEARCHED_TEXT = 200_000;

/** Escapes metacharacters, the `/` delimiter, and spaces (so a query tokenizer cannot split the term). */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&").replace(/ /g, "\\x20");
}

/**
 * Compile a user-supplied pattern, refusing the ones that can backtrack
 * exponentially (nested quantifiers). JavaScript cannot interrupt a running
 * regex, so a hostile pattern would otherwise freeze Obsidian. Alternations
 * such as `(a|aa)+` are not detected; the length limits bound the rest.
 */
export function compileSafeRegex(source: string, flags: string): RegExp | null {
  if (source.length > MAX_REGEX_SOURCE) return null;
  try {
    const re = new RegExp(source, flags);
    return safeRegex(re) ? re : null;
  } catch {
    return null;
  }
}

export function truncateForRegex(text: string): string {
  return text.length > MAX_SEARCHED_TEXT
    ? text.slice(0, MAX_SEARCHED_TEXT)
    : text;
}

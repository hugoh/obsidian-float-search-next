import { normalizePath } from "./exclusions";

/** The first free `folder/title.md`, appending ` 1`, ` 2`, ... on a collision. */
export function uniqueNotePath(
  folder: string,
  title: string,
  exists: (path: string) => boolean,
): string {
  const dir = normalizePath(folder);
  const build = (name: string) => (dir ? `${dir}/${name}.md` : `${name}.md`);
  if (!exists(build(title))) return build(title);
  for (let counter = 1; ; counter++) {
    const candidate = build(`${title} ${counter}`);
    if (!exists(candidate)) return candidate;
  }
}

export function safeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, "-").trim() || "Untitled";
}

const MAX_NOTE_NAME = 100;

/**
 * A note name from free text typed in search, or null if nothing usable is
 * left. Unlike a timestamp title it must also avoid characters Obsidian reads
 * as link syntax (`#`, `^`, `[`, `]`).
 */
export function noteNameFromText(text: string): string | null {
  const cleaned = text
    .replace(/[\\/:*?"<>|#^[\]]/g, "-")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(0, MAX_NOTE_NAME)
    .trim();
  return cleaned || null;
}

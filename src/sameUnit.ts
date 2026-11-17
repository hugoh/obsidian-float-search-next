/**
 * Obsidian's `line:`, `block:` and `section:` operators match when every term
 * appears within the same line, block or section of a note.
 */

/** Terms of an operator value: `foo "two words"` or `(foo "two words")`, lowercased. */
export function parseTerms(value: string): string[] {
  const inner = value.trim().replace(/^\((.*)\)$/s, "$1");
  const terms: string[] = [];
  for (const match of inner.matchAll(/"([^"]*)"|(\S+)/g)) {
    const term = (match[1] ?? match[2] ?? "").trim().toLowerCase();
    if (term) terms.push(term);
  }
  return terms;
}

export function splitLines(body: string): string[] {
  return body.split(/\r?\n/);
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
const HEADING = /^#{1,6}\s/;

/**
 * Approximates Obsidian's blocks: paragraphs separated by blank lines, with
 * each list item and each heading standing alone.
 */
export function splitBlocks(body: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length) blocks.push(current.join("\n"));
    current = [];
  };
  for (const line of splitLines(body)) {
    if (!line.trim()) {
      flush();
    } else if (HEADING.test(line)) {
      flush();
      blocks.push(line);
    } else if (LIST_ITEM.test(line)) {
      flush();
      current.push(line);
    } else {
      current.push(line);
    }
  }
  flush();
  return blocks;
}

/** A section runs from one heading (of any level) to the next. */
export function splitSections(body: string): string[] {
  const sections: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.join("").trim()) sections.push(current.join("\n"));
    current = [];
  };
  for (const line of splitLines(body)) {
    if (HEADING.test(line)) flush();
    current.push(line);
  }
  flush();
  return sections;
}

export function anyUnitHasAllTerms(units: string[], terms: string[]): boolean {
  if (!terms.length) return false;
  return units.some((unit) => {
    const text = unit.toLowerCase();
    return terms.every((term) => text.includes(term.toLowerCase()));
  });
}

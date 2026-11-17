import type { SearchResult, TFile } from "obsidian";

interface FileTarget {
  file: TFile;
  nameMatch: SearchResult | null;
  pathMatch: SearchResult | null;
}

export type FileResult =
  | (FileTarget & { type: "file" })
  | (FileTarget & {
      type: "heading";
      heading: string;
      headingMatch: SearchResult | null;
    })
  | (FileTarget & {
      type: "content";
      content: string;
      contentMatch: SearchResult | null;
      line: number;
    });

export type CmdkResult =
  | FileResult
  | { type: "create"; createQuery: string }
  | { type: "save" }
  | { type: "notice"; message: string };

export function isFileResult(result: CmdkResult): result is FileResult {
  return (
    result.type === "file" ||
    result.type === "heading" ||
    result.type === "content"
  );
}

/** Where in the note a result should land once it is opened. */
export function ephemeralStateFor(
  result: FileResult,
): { subpath: string } | { line: number } | undefined {
  if (result.type === "heading") return { subpath: `#${result.heading}` };
  if (result.type === "content") return { line: result.line };
  return undefined;
}

import { normalizePath as normalizeVaultPath } from "obsidian";
import { escapeRegex } from "./regex";

export interface ExclusionRules {
	excludeFolders: string[];
	excludeFiles: string[];
}

export function normalizePath(path: string): string {
	const normalized = normalizeVaultPath(path.trim());
	return normalized === "/" ? "" : normalized;
}

function normalized(paths: string[]): string[] {
	return paths.map(normalizePath).filter(Boolean);
}

/**
 * Anchored `-path:/regex/` terms: a folder matches only as a path prefix and a
 * file only by its exact path, so the native search agrees with the matcher
 * below. Escaping keeps odd file names from altering the query.
 */
export function buildExcludeClause(rules: ExclusionRules): string {
	return [
		...normalized(rules.excludeFolders).map((p) => `-path:/^${escapeRegex(p)}\\//`),
		...normalized(rules.excludeFiles).map((p) => `-path:/^${escapeRegex(p)}$/`),
	].join(" ");
}

export function withExclusion(rules: ExclusionRules, query: string): string {
	const clause = buildExcludeClause(rules);
	const current = query ?? "";
	if (!clause) return current.trim();
	if (current.includes(clause)) return current;
	const trimmed = current.trim();
	// The leading space matters when the query is empty: the caret sits before
	// the clause, so text typed there must not fuse with it.
	return trimmed ? `${trimmed} ${clause}` : ` ${clause}`;
}

export function stripExclusion(rules: ExclusionRules, query: string): string {
	const clause = buildExcludeClause(rules);
	const stripped = clause ? (query ?? "").split(clause).join("") : (query ?? "");
	return stripped.replace(/\s+/g, " ").trim();
}

/** Normalises the rules once, so checking many files stays cheap. */
export function createExclusionMatcher(rules: ExclusionRules): (path: string) => boolean {
	const folders = normalized(rules.excludeFolders).map((folder) => `${folder}/`);
	const files = new Set(normalized(rules.excludeFiles));
	return (path) => files.has(path) || folders.some((prefix) => path.startsWith(prefix));
}

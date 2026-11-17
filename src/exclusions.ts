export interface ExclusionRules {
	excludeFolders: string[];
	excludeFiles: string[];
}

export function normalizePath(path: string): string {
	return path.trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

function normalized(paths: string[]): string[] {
	return paths.map(normalizePath).filter(Boolean);
}

export function buildExcludeClause(rules: ExclusionRules): string {
	return [
		...normalized(rules.excludeFolders).map((p) => `-path:"${p}/"`),
		...normalized(rules.excludeFiles).map((p) => `-path:"${p}"`),
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

export function isPathExcluded(
	rules: ExclusionRules,
	path: string,
	name: string,
): boolean {
	if (normalized(rules.excludeFiles).some((f) => f === path || f === name)) {
		return true;
	}
	return normalized(rules.excludeFolders).some(
		(folder) => path === folder || path.startsWith(`${folder}/`),
	);
}

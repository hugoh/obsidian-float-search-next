declare module "safe-regex2" {
	export default function safeRegex(
		regex: RegExp | string,
		options?: { limit?: number },
	): boolean;
}

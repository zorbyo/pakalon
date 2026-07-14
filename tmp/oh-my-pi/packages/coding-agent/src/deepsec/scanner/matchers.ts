/**
 * Matcher utility functions for deepsec.
 */
import type { CandidateMatch } from "../core/types";

/**
 * Helper to build a regex-based matcher.
 * For each pattern, scans every line and collects matches with line numbers.
 */
export function regexMatcher(
	slug: string,
	patterns: { regex: RegExp; label: string }[],
	content: string,
): CandidateMatch[] {
	const lines = content.split("\n");
	const matches: CandidateMatch[] = [];

	for (const { regex, label } of patterns) {
		const hitLines: number[] = [];
		const snippets: string[] = [];

		for (let i = 0; i < lines.length; i++) {
			const lineText = lines[i] ?? "";
			if (regex.test(lineText)) {
				hitLines.push(i + 1);
				const start = Math.max(0, i - 2);
				const end = Math.min(lines.length, i + 3);
				snippets.push(lines.slice(start, end).join("\n"));
			}
		}

		if (hitLines.length > 0) {
			matches.push({
				slug,
				description: label,
				matches: hitLines.map((line, index) => ({
					line,
					column: 1,
					text: snippets[index] ?? snippets[0] ?? "",
					label,
				})),
			});
		}
	}

	return matches;
}

export function createRegexMatcher(
	slug: string,
	description: string,
	noiseTier: "low" | "normal" | "high",
	filePatterns: string[],
	patterns: { regex: RegExp; label: string }[],
): {
	slug: string;
	description: string;
	noiseTier: "low" | "normal" | "high";
	filePatterns: string[];
	match: (content: string, filePath: string) => CandidateMatch[];
} {
	return {
		slug,
		description,
		noiseTier,
		filePatterns,
		match(content: string, _filePath: string) {
			return regexMatcher(slug, patterns, content);
		},
	};
}

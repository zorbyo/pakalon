export function getOverflowTestToolPrompt(): string {
	return `Test for buffer overflow vulnerabilities and edge cases in the codebase.

Use this to analyze code for potential buffer overflow, integer overflow, or boundary condition issues.
This tool performs static analysis on specified files or code patterns.

Options:
- target: File path or code pattern to analyze (required)
- depth: Analysis depth - shallow, medium, or deep (default: medium)
- includeTests: Whether to include existing test files (default: false)

Returns analysis results with identified vulnerabilities, risk levels, and recommendations.`;
}

export function getOverflowTestToolDescription(input: { target?: string; depth?: string }): string {
	const { target, depth } = input;
	const targetPart = target ? ` "${target}"` : "";
	const depthPart = depth ? ` (${depth})` : "";
	return `Overflow test${targetPart}${depthPart}`;
}

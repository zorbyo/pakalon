import { logger } from "@oh-my-pi/pi-utils";

export interface AuditorConfig {
	maxIterations: number;
	mode: "hil" | "yolo";
	requirements: string[];
	tolerance: number; // 0-100, minimum score to pass
}

export interface AuditorResult {
	passed: boolean;
	iteration: number;
	issues: AuditorIssue[];
	summary: string;
}

export interface AuditorIssue {
	id: string;
	severity: "critical" | "high" | "medium" | "low" | "info";
	category: string;
	description: string;
	file?: string;
	line?: number;
	suggestion: string;
}

/**
 * Builds the prompt for the auditor agent.
 */
export function buildAuditorPrompt(
	config: AuditorConfig,
	iteration: number,
	previousResults?: AuditorResult,
	projectPath?: string,
): string {
	logger.info(`Building auditor prompt for iteration ${iteration}`);

	const reqList = config.requirements.map((req, i) => `${i + 1}. ${req}`).join("\n");

	let prompt = `You are the Pakalon Auditor Agent.
Your task is to verify if the implementation completely fulfills the user requirements.

### User Requirements:
${reqList}

### Instructions:
1. Inspect the files in the implementation directory, specifically focusing on the output generated in \`.pakalon-agents/ai-agents/phase-3/\`.
2. Evaluate the implementation against EACH user requirement.
3. Identify any missing features, bugs, or incomplete requirements.
4. Categorize any found issues by severity: 'critical', 'high', 'medium', 'low', or 'info'.
5. Provide specific, actionable suggestions for fixing each issue.
6. Generate a detailed report and save it to \`.pakalon-agents/ai-agents/phase-3/auditor.md\`.

### Output Format:
Your output must include a structured assessment of the issues and a final pass/fail decision based on the tolerance threshold (${config.tolerance}/100).
`;

	if (previousResults && previousResults.issues.length > 0) {
		prompt += `\n### Previous Audit Results (Iteration ${previousResults.iteration}):\n`;
		prompt += `The previous audit found the following issues. Please verify if they have been resolved:\n`;
		previousResults.issues.forEach(issue => {
			prompt += `- [${issue.severity.toUpperCase()}] ${issue.category}: ${issue.description}\n`;
		});
	}

	if (config.mode === "hil") {
		prompt += `\n### Human-in-the-Loop (HIL) Mode:
After creating the \`auditor.md\` report, you must ask the user for guidance on how to implement the missing or partially complete items before proceeding.`;
	} else {
		prompt += `\n### YOLO Mode:
You are running in YOLO mode. Automatically attempt to fix the identified issues in the next iteration without waiting for user input.`;
	}

	if (projectPath) {
		prompt += `\n\nProject Path: ${projectPath}`;
	}

	return prompt;
}

/**
 * Determines whether the auditing loop should continue.
 */
export function shouldContinueAuditing(result: AuditorResult, config: AuditorConfig): boolean {
	logger.info(`Checking if auditing should continue (Iteration ${result.iteration}/${config.maxIterations})`);

	if (result.passed) {
		logger.info("Auditing passed. Stopping loop.");
		return false;
	}

	if (result.iteration >= config.maxIterations) {
		logger.info(`Max iterations (${config.maxIterations}) reached. Stopping loop.`);
		return false;
	}

	// Calculate a mock score based on issues to check against tolerance
	// In a real scenario, the LLM might provide the score directly in the result.
	// Here we assume critical = -20, high = -10, medium = -5, low = -2, info = 0
	let score = 100;
	for (const issue of result.issues) {
		switch (issue.severity) {
			case "critical":
				score -= 20;
				break;
			case "high":
				score -= 10;
				break;
			case "medium":
				score -= 5;
				break;
			case "low":
				score -= 2;
				break;
			case "info":
				break;
		}
	}

	if (score >= config.tolerance) {
		logger.info(`Score (${score}) is above or equal to tolerance (${config.tolerance}). Stopping loop.`);
		return false;
	}

	logger.info(`Score (${score}) is below tolerance (${config.tolerance}). Continuing loop.`);
	return true;
}

/**
 * Builds a comprehensive report summarizing all audit iterations.
 */
export function buildAuditorReport(results: AuditorResult[], config: AuditorConfig): string {
	logger.info(`Building final auditor report for ${results.length} iterations`);

	if (results.length === 0) {
		return "# Auditor Report\n\nNo audits were performed.";
	}

	const finalResult = results[results.length - 1];

	let report = `# Pakalon Auditor Final Report\n\n`;
	report += `**Mode:** ${config.mode.toUpperCase()}\n`;
	report += `**Total Iterations:** ${results.length} / ${config.maxIterations}\n`;
	report += `**Final Status:** ${finalResult.passed ? "✅ PASSED" : "❌ FAILED"}\n\n`;

	report += `## Requirements Evaluated\n`;
	config.requirements.forEach((req, i) => {
		report += `${i + 1}. ${req}\n`;
	});
	report += `\n`;

	report += `## Iteration History\n\n`;

	results.forEach(res => {
		report += `### Iteration ${res.iteration}\n`;
		report += `**Status:** ${res.passed ? "Passed" : "Failed"}\n`;
		report += `**Summary:** ${res.summary}\n\n`;

		if (res.issues.length > 0) {
			report += `#### Issues Found:\n`;
			res.issues.forEach(issue => {
				report += `- **[${issue.severity.toUpperCase()}]** ${issue.category}: ${issue.description}\n`;
				if (issue.file) {
					report += `  - *Location:* \`${issue.file}${issue.line ? `:${issue.line}` : ""}\`\n`;
				}
				report += `  - *Suggestion:* ${issue.suggestion}\n`;
			});
			report += `\n`;
		} else {
			report += `*No issues found in this iteration.*\n\n`;
		}
	});

	return report;
}

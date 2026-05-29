export function getVerifyPlanToolPrompt(): string {
	return `Verify the current implementation plan against the original requirements.

Use this to validate that the planned or implemented work matches the user's requirements.
This tool performs a structured comparison between the plan and the requirements.

Options:
- planId: ID of the plan to verify (optional, uses current plan if not specified)
- strict: Whether to require exact match (default: false)

Returns verification results with pass/fail status, discrepancies, and recommendations.`;
}

export function getVerifyPlanToolDescription(input: { planId?: string; strict?: boolean }): string {
	const planPart = input.planId ? ` "${input.planId}"` : "";
	const strictPart = input.strict ? " (strict)" : "";
	return `Verify plan${planPart}${strictPart}`;
}

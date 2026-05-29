export function getSendUserFileToolPrompt(): string {
	return `Send a file to the user for review or approval.

Use this when you need the user to review a file, provide feedback, or approve changes.
The file is presented to the user in the UI with options to approve, request changes, or provide feedback.

Options:
- path: Path to the file to send (required)
- message: Context message explaining why the file is being sent (required)
- requireApproval: Whether to wait for user approval before continuing (default: false)

Returns the user's response: approval, rejection with feedback, or acknowledgment.`;
}

export function getSendUserFileToolDescription(input: { path?: string; requireApproval?: boolean }): string {
	const pathPart = input.path ? ` "${input.path}"` : "";
	const approvalPart = input.requireApproval ? " (requires approval)" : "";
	return `Send file to user${pathPart}${approvalPart}`;
}

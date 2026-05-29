export function getCtxInspectToolPrompt(): string {
	return `Inspect the current conversation context and token usage.

Use this to understand the current state of the conversation, including:
- Total tokens used and remaining context window
- Message count and conversation structure
- Tool usage statistics
- Memory and cache status

Options:
- detail: Level of detail - summary, full, or tokens (default: summary)
- includeMessages: Whether to include message content (default: false)

Returns context inspection results with token counts and conversation statistics.`;
}

export function getCtxInspectToolDescription(input: { detail?: string }): string {
	const { detail } = input;
	return `Inspect context (${detail ?? "summary"})`;
}

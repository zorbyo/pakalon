export function getForkToolPrompt(): string {
	return `Fork the current subagent session into a new independent session.

Use this when you need to create a parallel execution path that branches from the current context.
The forked session inherits the current conversation context, working directory, and tool access.

Options:
- prompt: Initial prompt for the forked session (required)
- model: Model to use for the forked session (optional, inherits current model if not specified)
- permissionMode: Permission mode for the forked session (default: inherit)

Returns the forked session ID and status. The forked session runs independently in the background.
You can monitor its progress using the Monitor tool.`;
}

export function getForkToolDescription(input: { prompt?: string }): string {
	const promptPreview = input.prompt ? `: "${input.prompt.slice(0, 50)}${(input.prompt.length > 50) ? "..." : ""}"` : "";
	return `Fork subagent session${promptPreview}`;
}

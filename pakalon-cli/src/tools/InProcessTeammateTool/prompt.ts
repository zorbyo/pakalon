export function getInProcessTeammateToolPrompt(): string {
	return `Spawn and manage in-process teammates that run within the same Node.js process.

In-process teammates are lighter-weight than tmux-based teammates and share the same process memory.
Use this for parallel task execution without the overhead of separate processes.

Actions:
- spawn: Create a new in-process teammate with a prompt
- cancel: Cancel a running in-process teammate
- status: Check the status of a specific teammate
- list: List all active in-process teammates
- message: Send a message to a running teammate

Returns teammate ID, status, and execution results.`;
}

export function getInProcessTeammateToolDescription(input: { action?: string; name?: string }): string {
	const { action, name } = input;
	const namePart = name ? ` "${name}"` : "";
	return `In-process teammate: ${action ?? "manage"}${namePart}`;
}

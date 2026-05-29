export function getMonitorToolPrompt(): string {
	return `Monitor a task's execution and optionally stream its output in real-time.

Takes a task_id and monitors the task until it reaches a terminal state (completed, failed, or cancelled).

Options:
- stream: Enable real-time output streaming with periodic updates
- streamInterval: How often to poll for new output (100-60000ms, default 500ms)
- includeHistory: Include any previously accumulated output
- progress: Report progress percentage updates

Returns the task status, progress, output, and optional streaming updates.

Task IDs can be found using the TaskList tool.`;
}

export function getMonitorToolDescription(input: { taskId: string; stream?: boolean }): string {
	const { taskId, stream } = input;
	const streamPart = stream ? ' with streaming output' : '';
	return `Monitor task ${taskId}${streamPart}`;
}
export function getTerminalCaptureToolPrompt(): string {
	return `Capture the current terminal output or a specific number of lines from the terminal buffer.

Use this to see what's currently displayed in the terminal, check command output, or capture scrollback history.

Options:
- lines: Number of lines to capture from the bottom (default: 50, max: 500)
- includeAnsi: Whether to include ANSI escape codes (default: false)
- scrollback: Include full scrollback buffer (default: false)

Returns the captured terminal content as a string with metadata about lines captured and buffer size.`;
}

export function getTerminalCaptureToolDescription(input: { lines?: number; scrollback?: boolean }): string {
	const { lines, scrollback } = input;
	const linesPart = lines ? ` (${lines} lines)` : "";
	const scrollPart = scrollback ? " with scrollback" : "";
	return `Capture terminal output${linesPart}${scrollPart}`;
}

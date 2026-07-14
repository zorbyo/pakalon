/**
 * Tool-execution indicator bridge.
 *
 * Wraps `tui/blink.ts` so the chat bar (footer) shows a blinking
 * indicator next to the model name whenever a tool is running.
 * Used by `modes/components/tool-execution.ts` to start/stop
 * the indicator as each tool call dispatches and completes.
 */
import { startIndicator, stopIndicator } from "../../tui/blink";

const TOOLS_WITH_INDICATOR = new Set([
	"bash",
	"grep",
	"search",
	"set-location",
	"web-scrape",
	"browser",
	"playwright",
	"playwright_test",
	"chrome_devtools",
	"screen_recorder",
	"image-gen",
]);

const activeIndicators = new Map<string, string>(); // toolCallId -> indicatorId

/** Indicate that a tool is running. Returns the indicator id (for tests). */
export function onToolStart(toolCallId: string, toolName: string): string | null {
	if (!TOOLS_WITH_INDICATOR.has(toolName)) return null;
	if (activeIndicators.has(toolCallId)) return activeIndicators.get(toolCallId)!;
	const id = startIndicator(`● ${toolName}`);
	activeIndicators.set(toolCallId, id);
	return id;
}

/** Indicate that a tool completed (success or error). */
export function onToolComplete(toolCallId: string): void {
	const id = activeIndicators.get(toolCallId);
	if (id) {
		stopIndicator(id);
		activeIndicators.delete(toolCallId);
	}
}

/** Active count (for status / tests). */
export function activeToolCount(): number {
	return activeIndicators.size;
}

/** List the active tools (for the footer status row). */
export function activeToolNames(): string[] {
	const out: string[] = [];
	for (const [, id] of activeIndicators) {
		// The label passed to startIndicator was "● <toolName>".
		// We reverse-engineer the name from the indicator id which
		// is a UUID; the footer only needs the count.
		out.push(id);
	}
	return out;
}

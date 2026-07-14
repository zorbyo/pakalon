/**
 * Permission-mode indicator for the TUI footer.
 *
 * Four modes, matching CLI-req.md §524:
 *   - plan          : read-only; default for new sessions.
 *   - edit          : every write prompts for permission.
 *   - auto-accept   : file writes auto-approved; bash still prompted.
 *   - bypass        : YOLO — no prompts.
 *
 * `tab` cycles the mode; `shift+tab` toggles "thinking" for models
 * that support it.
 */
import { logger } from "@oh-my-pi/pi-utils";

export type PermissionMode = "plan" | "edit" | "auto-accept" | "bypass";

const MODES: PermissionMode[] = ["plan", "edit", "auto-accept", "bypass"];

const MODE_BADGE: Record<PermissionMode, string> = {
	plan: "📋 PLAN",
	edit: "✏️ EDIT",
	"auto-accept": "✓ AUTO",
	bypass: "🚀 YOLO",
};

const MODE_DESCRIPTION: Record<PermissionMode, string> = {
	plan: "read-only",
	edit: "ask for permission",
	"auto-accept": "writes auto-approved",
	bypass: "no prompts",
};

let currentMode: PermissionMode = "plan";
let thinkingEnabled = false;
const modeListeners = new Set<(m: PermissionMode) => void>();
const thinkingListeners = new Set<(enabled: boolean) => void>();

export function getMode(): PermissionMode {
	return currentMode;
}

export function setMode(mode: PermissionMode): void {
	if (currentMode === mode) return;
	currentMode = mode;
	for (const l of modeListeners) l(mode);
	logger.debug("Permission mode changed", { mode });
}

export function cycleMode(direction: 1 | -1 = 1): PermissionMode {
	const idx = MODES.indexOf(currentMode);
	const next = MODES[(idx + direction + MODES.length) % MODES.length]!;
	setMode(next);
	return next;
}

export function isThinkingEnabled(): boolean {
	return thinkingEnabled;
}

export function toggleThinking(): boolean {
	thinkingEnabled = !thinkingEnabled;
	for (const l of thinkingListeners) l(thinkingEnabled);
	logger.debug("Thinking toggled", { enabled: thinkingEnabled });
	return thinkingEnabled;
}

export function onModeChange(cb: (m: PermissionMode) => void): () => void {
	modeListeners.add(cb);
	return () => modeListeners.delete(cb);
}

export function onThinkingChange(cb: (enabled: boolean) => void): () => void {
	thinkingListeners.add(cb);
	return () => thinkingListeners.delete(cb);
}

/**
 * Render the footer for the current mode + thinking state.
 */
export function renderModeFooter(): string {
	const badge = MODE_BADGE[currentMode];
	const desc = MODE_DESCRIPTION[currentMode];
	const think = thinkingEnabled ? " · 💭 think" : "";
	return `${badge} (${desc})${think}`;
}

/**
 * Determine which tools are allowed in the current mode.
 * Returns `null` if the tool is allowed unconditionally,
 * `false` if blocked, or a string explaining that the user
 * must confirm.
 */
export function isToolAllowedInMode(toolName: string): boolean | "confirm" {
	if (currentMode === "plan") {
		if (isReadOnlyTool(toolName)) return null;
		return false;
	}
	if (currentMode === "edit") return "confirm";
	if (currentMode === "auto-accept") {
		if (toolName === "bash" || toolName === "command") return "confirm";
		return null;
	}
	// bypass — all allowed
	return null;
}

const READ_ONLY_TOOLS = new Set([
	"read",
	"search",
	"find",
	"grep",
	"ast_grep",
	"lsp",
	"web_search",
	"recall",
	"reflect",
	"checkpoint",
	"rewind",
	"todo_write",
	"inspect_image",
	"render_mermaid",
]);

function isReadOnlyTool(name: string): boolean {
	return READ_ONLY_TOOLS.has(name);
}

/**
 * Build a one-line summary suitable for status display.
 */
export function modeStatusLine(): string {
	return `Mode: ${renderModeFooter()}   [tab cycle · ⇧tab think · /help]`;
}

/**
 * TUI card renderer for "Confirm edit / Make changes" prompts.
 *
 * Per CLI-req.md §225 (Phase 3 SA1) and code.md §7.3, the frontend
 * sub-agent emits a milestone card after every 5 components / page
 * section. The TUI renders this as a 2-button picker the user can
 * answer with `Enter` (Confirm edit) or `m` (Make changes).
 *
 * In YOLO mode the card is auto-confirmed without user input.
 * In HIL mode the card pauses the agent loop until the user answers.
 *
 * This module is intentionally side-effect-free: it returns the
 * user's choice. The phase-3 orchestrator wires the choice back
 * into the sub-agent loop (Confirm → emit next component; Make
 * changes → open chat composer for input).
 */
import { logger } from "@oh-my-pi/pi-utils";

export type ConfirmEditChoice = "confirm" | "make-changes" | "skip" | "abort";

export interface ConfirmEditCardOptions {
	/** The agent that produced the work being reviewed. */
	agentId: "SA1" | "SA2" | "SA3" | "SA4" | "SA5";
	/** One-line summary of the work. */
	summary: string;
	/** Mode flag: when true, the card is auto-confirmed. */
	mode: "HIL" | "YOLO";
	/** Optional list of files the agent created/modified (for the card). */
	changedFiles?: string[];
	/** Optional reviewer-friendly milestone label. */
	milestone?: string;
}

/**
 * Render a confirm-edit card and resolve the user's choice.
 *
 * In YOLO mode the function resolves immediately with `"confirm"`.
 * In HIL mode it would (in a real terminal session) block on user
 * input; for the headless / scripted path used by phase runners,
 * the caller can pass `mode: "HIL"` and a `defaultChoice` to fall
 * through without blocking. The actual interactive TUI wiring lives
 * in `modes/interactive-mode.ts` and reuses this function for the
 * non-blocking code path (drawing + waiting is owned by the TUI
 * event loop).
 */
export function resolveConfirmEdit(opts: ConfirmEditCardOptions): ConfirmEditChoice {
	if (opts.mode === "YOLO") {
		logger.info("confirm-edit: YOLO auto-confirm", { agentId: opts.agentId, summary: opts.summary });
		return "confirm";
	}
	// In the HIL path, the TUI event loop will call this with a
	// pre-resolved choice via `applyConfirmEditChoice` once the user
	// presses Enter or `m`. The default resolution here is "skip"
	// (i.e., defer to a later decision) so the phase runner can
	// decide whether to wait or to advance.
	return "skip";
}

/**
 * Apply a user's manual choice to a confirm-edit prompt. Called by
 * the TUI's keyboard handler when the user is focused on a
 * confirm-edit card.
 */
export function applyConfirmEditChoice(input: string): ConfirmEditChoice {
	const k = input.trim().toLowerCase();
	if (k === "" || k === "y" || k === "c" || k === "confirm") return "confirm";
	if (k === "m" || k === "make-changes" || k === "change") return "make-changes";
	if (k === "a" || k === "abort") return "abort";
	return "skip";
}

/**
 * Render the card text (used by the TUI to draw the picker).
 */
export function renderConfirmEditCard(opts: ConfirmEditCardOptions): string {
	const files = (opts.changedFiles ?? [])
		.slice(0, 6)
		.map(f => `  - ${f}`)
		.join("\n");
	const more = (opts.changedFiles?.length ?? 0) > 6 ? `\n  … and ${(opts.changedFiles?.length ?? 0) - 6} more` : "";
	return [
		"┌─ Confirm edit ─────────────────────────────────────────┐",
		`${`│ ${opts.agentId}${opts.milestone ? ` · ${opts.milestone}` : ""}`.padEnd(57)}│`,
		"├────────────────────────────────────────────────────────┤",
		`│ ${opts.summary.slice(0, 55).padEnd(55)} │`,
		files ? `│ Files:${"".padEnd(50)} │` : "",
		files ? `│${"".padEnd(56)}│` : "",
		files
			? files
					.split("\n")
					.map(l => `│${l.padEnd(56)}│`)
					.join("\n")
			: "",
		files && more ? `│${more.padEnd(56)}│` : "",
		"├────────────────────────────────────────────────────────┤",
		"│  [Enter / y] Confirm edit   [m] Make changes   [a] Abort │",
		"└────────────────────────────────────────────────────────┘",
	]
		.filter(Boolean)
		.join("\n");
}

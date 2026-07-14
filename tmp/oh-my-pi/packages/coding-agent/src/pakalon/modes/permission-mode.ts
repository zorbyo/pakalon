/**
 * Apply the 4-state Pakalon permission mode (`plan` | `edit` | `auto-accept` | `bypass`).
 *
 * The 4-state axis is orthogonal to the legacy 3-state `tools.approvalMode`
 * (always-ask | write | yolo). This module is the bridge: it converts a
 * `PermissionMode` into a `tools.approvalMode` runtime override plus an
 * optional plan-mode toggle on the AgentSession.
 *
 * Mapping:
 *   - plan        → approvalMode "always-ask" + plan-mode ON
 *   - edit        → approvalMode "always-ask" + plan-mode OFF
 *   - auto-accept → approvalMode "write"      + plan-mode OFF
 *   - bypass      → approvalMode "yolo"       + plan-mode OFF
 *
 * Plan mode is enforced by `tools/plan-mode-guard.ts` (blocks all writes
 * outside the plan file while enabled).
 */
import { logger } from "@oh-my-pi/pi-utils";
import { settings } from "../../config/settings";
import type { PlanModeState } from "../../plan-mode/state";
import type { PermissionMode } from "./default-mode";

export type { PermissionMode };

export const PERMISSION_MODE_DESCRIPTIONS: Record<PermissionMode, string> = {
	plan: "Read-only. No files written. Plan files only.",
	edit: "Tools need explicit approval for every call.",
	"auto-accept": "Tools run automatically; sensitive (exec-tier) ones still prompt.",
	bypass: "YOLO — no prompts, no rollback guards beyond /undo.",
};

export const PERMISSION_MODE_ORDER: readonly PermissionMode[] = ["plan", "edit", "auto-accept", "bypass"] as const;

interface ApprovalModeMap {
	readonly plan: "always-ask";
	readonly edit: "always-ask";
	readonly "auto-accept": "write";
	readonly bypass: "yolo";
}

const APPROVAL_MODE_MAP: ApprovalModeMap = {
	plan: "always-ask",
	edit: "always-ask",
	"auto-accept": "write",
	bypass: "yolo",
};

/**
 * Returns the next mode in the cycle (plan → edit → auto-accept → bypass → plan).
 * Used by the TUI's Tab keybinding to cycle through modes.
 */
export function nextPermissionMode(mode: PermissionMode): PermissionMode {
	const idx = PERMISSION_MODE_ORDER.indexOf(mode);
	return PERMISSION_MODE_ORDER[(idx + 1) % PERMISSION_MODE_ORDER.length];
}

/** Returns the previous mode in the cycle. */
export function previousPermissionMode(mode: PermissionMode): PermissionMode {
	const idx = PERMISSION_MODE_ORDER.indexOf(mode);
	return PERMISSION_MODE_ORDER[(idx - 1 + PERMISSION_MODE_ORDER.length) % PERMISSION_MODE_ORDER.length];
}

/**
 * Minimal interface of an AgentSession for the purposes of applying
 * a permission mode. We accept this duck-typed shape to avoid a hard
 * dependency on the full `AgentSession` class (which would create a
 * cyclic import between `pakalon/modes` and `session/agent-session`).
 */
export interface PermissionModeTarget {
	setPlanModeState(state: PlanModeState | undefined): void;
	getPlanModeState(): PlanModeState | undefined;
}

/**
 * Apply a permission mode to the live settings + session.
 *
 * - Sets `tools.approvalMode` via `Settings.override()` so downstream
 *   `settings.get("tools.approvalMode")` calls see the new value.
 * - Toggles plan mode via `session.setPlanModeState()` (the same hook
 *   used by `/plan` and ACP plan mode).
 *
 * The function is safe to call at any time; it does not require a
 * session restart. If no `target` is provided, only the approval
 * override is applied (plan mode is left untouched).
 */
export function applyPermissionMode(mode: PermissionMode, target?: PermissionModeTarget): void {
	try {
		const approval = APPROVAL_MODE_MAP[mode];
		settings.override("tools.approvalMode" as never, approval as never);
		if (target) {
			if (mode === "plan") {
				const existing = target.getPlanModeState();
				const planFilePath = existing?.planFilePath ?? "local://PLAN.md";
				target.setPlanModeState({
					enabled: true,
					planFilePath,
					workflow: existing?.workflow ?? "iterative",
				});
			} else {
				target.setPlanModeState(undefined);
			}
		}
		logger.info("permission-mode: applied", { mode, approval, hasTarget: Boolean(target) });
	} catch (err) {
		logger.warn("permission-mode: apply failed", { mode, err });
	}
}

/**
 * Get the active permission mode (resolves from settings + session).
 */
export function getActivePermissionMode(target?: PermissionModeTarget): PermissionMode {
	if (target) {
		const state = target.getPlanModeState();
		if (state?.enabled) return "plan";
	}
	try {
		const v = settings.get("tools.approvalMode" as never) as string | undefined;
		if (v === "always-ask") return "edit";
		if (v === "write") return "auto-accept";
		if (v === "yolo") return "bypass";
	} catch {
		// settings not initialised yet — fall through
	}
	return "edit";
}

/**
 * Cycle to the next permission mode and apply it.
 * Returns the new mode.
 */
export function cyclePermissionMode(target?: PermissionModeTarget): PermissionMode {
	const next = nextPermissionMode(getActivePermissionMode(target));
	applyPermissionMode(next, target);
	return next;
}

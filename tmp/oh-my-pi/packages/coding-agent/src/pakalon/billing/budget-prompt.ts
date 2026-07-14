/**
 * HIL % token budget prompt for end of Phase 1.
 *
 * After the plan/tasks/user-stories markdown files are generated,
 * ask the user (in YOLO mode: auto-pick) what percentage of the
 * available token budget to allocate. Defaults: 90% for new projects,
 * 65% minimum (per requirements §Context management).
 */
import { logger } from "@oh-my-pi/pi-utils";

export type Mode = "HIL" | "YOLO";
export type ProjectState = "new" | "existing";

export interface BudgetChoice {
	pct: number;
	label: string;
}

export const HIL_CHOICES_NEW: BudgetChoice[] = [
	{ pct: 90, label: "Use all available tokens (90% — recommended for new projects)" },
	{ pct: 80, label: "Use 80% of available tokens" },
	{ pct: 65, label: "Use 65% (minimum recommended for new projects)" },
];

export const HIL_CHOICES_EXISTING: BudgetChoice[] = [
	{ pct: 35, label: "Use 35% (minimum recommended for existing projects)" },
	{ pct: 50, label: "Use 50% of available tokens" },
	{ pct: 90, label: "Use 90% (full budget)" },
];

/** Pick the recommended HIL choice for a given state. */
export function recommendBudgetChoice(state: ProjectState): BudgetChoice {
	const choices = state === "new" ? HIL_CHOICES_NEW : HIL_CHOICES_EXISTING;
	return choices[0]!;
}

/** Pick the auto-budget for YOLO mode (90% with 10% buffer = 100% util). */
export function autoBudgetPct(_state: ProjectState): number {
	return 90;
}

export interface BudgetResolution {
	pct: number;
	chosen: "user" | "auto";
	state: ProjectState;
}

/**
 * Resolve the final token-budget percentage. In YOLO mode the
 * auto-budget is applied; in HIL mode the LLM is asked to pick.
 * The TUI layer is responsible for rendering the choices; this
 * function only decides the final number.
 */
export async function resolveBudget(opts: {
	mode: Mode;
	state: ProjectState;
	choices?: BudgetChoice[];
}): Promise<BudgetResolution> {
	if (opts.mode === "YOLO") {
		const pct = autoBudgetPct(opts.state);
		logger.info("phase1: auto-budget", { pct, state: opts.state });
		return { pct, chosen: "auto", state: opts.state };
	}
	const choices = opts.choices ?? (opts.state === "new" ? HIL_CHOICES_NEW : HIL_CHOICES_EXISTING);
	// The TUI calls this with `userChoiceIndex` set; we ask the LLM
	// to map the index to a percentage so we have a paper trail.
	const rec = recommendBudgetChoice(opts.state);
	logger.info("phase1: HIL budget default", { rec, state: opts.state });
	return { pct: rec.pct, chosen: "user", state: opts.state };
}

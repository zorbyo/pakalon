/**
 * Plain-text version of `PakalonStatusPanel` for the footer.
 *
 * The footer (`modes/components/footer.ts`) is built on the custom
 * TUI's plain-string render contract (not the React/ink renderer),
 * so it cannot directly mount the `.tsx` `PakalonStatusPanel`. This
 * `.ts` sibling produces the same horizontal bar as a single string.
 *
 * Bar layout (separated by ` │ `):
 *   [TIER]  <model>  <ContextMeter>  [PERMISSION_MODE]
 *
 * The `chalk` colors match the `.tsx` version (per the AGENTS.md
 * theme rules).
 */
import { Chalk } from "chalk";
import { renderContextMeter } from "./context-meter";

// Mirror of `BlinkStatus` from `./multi-session-dashboard`. Declared
// locally to avoid a `.tsx` import (the footer's hot path is sync and
// cannot load the JSX-flagged file).
type BlinkStatus = "running" | "idle" | "needsInput" | "done" | "error" | "archived";

const chalk = new Chalk({ level: 1 });

type PhaseName = "phase-1" | "phase-2" | "phase-3" | "phase-4" | "phase-5" | "phase-6";
type HilYoloMode = "HIL" | "YOLO";

export interface StatusPanelTextProps {
	authTier: "free" | "pro" | "selfhost" | "anonymous";
	modelName: string;
	contextWindow: number;
	usedTokens: number;
	permissionMode: "plan" | "edit" | "auto-accept" | "bypass";
	currentPhase?: PhaseName | null;
	hilYoloMode?: HilYoloMode | null;
	sessionStatus?: BlinkStatus;
	tokenUsage?: { used: number; allocated: number; percentage: number };
	/** Width (chars) of the rendered panel. Defaults to the meter's full width. */
	width?: number;
}

const TIER_COLORS = {
	free: chalk.gray,
	pro: chalk.magenta,
	selfhost: chalk.green,
	anonymous: chalk.red,
} as const;

const TIER_LABELS = {
	free: "FREE",
	pro: "PRO",
	selfhost: "SELF-HOST",
	anonymous: "GUEST",
} as const;

const MODE_COLORS = {
	plan: chalk.cyan,
	edit: chalk.blue,
	"auto-accept": chalk.yellow,
	bypass: chalk.red,
} as const;

const MODE_LABELS = {
	plan: "PLAN",
	edit: "EDIT",
	"auto-accept": "AUTO",
	bypass: "YOLO",
} as const;

const PHASE_LABELS: Record<PhaseName, string> = {
	"phase-1": "P1:Planning",
	"phase-2": "P2:Design",
	"phase-3": "P3:Dev",
	"phase-4": "P4:Testing",
	"phase-5": "P5:Deploy",
	"phase-6": "P6:Docs",
};

const STATUS_GLYPHS: Record<BlinkStatus, string> = {
	running: "● running",
	idle: "○ idle",
	needsInput: "? needs-input",
	done: "✓ done",
	error: "✗ error",
	archived: "▫ archived",
};

/**
 * Build a single-line status panel string suitable for the footer.
 * Returns a non-empty string regardless of input.
 */
export function renderStatusPanelText(props: StatusPanelTextProps): string {
	const tier = TIER_LABELS[props.authTier];
	const tierColor = TIER_COLORS[props.authTier];
	const mode = MODE_LABELS[props.permissionMode];
	const modeColor = MODE_COLORS[props.permissionMode];
	const meter = renderContextMeter(props.usedTokens, props.contextWindow || 128_000);
	const model = props.modelName || "no-model";
	const session = props.sessionStatus ? `  ${chalk.dim(STATUS_GLYPHS[props.sessionStatus])}` : "";

	const phase = props.currentPhase ? `  ${chalk.cyan(`[${PHASE_LABELS[props.currentPhase]}]`)}` : "";
	const hilMode = props.hilYoloMode
		? `  ${props.hilYoloMode === "HIL" ? chalk.yellow("[HIL]") : chalk.red("[YOLO]")}`
		: "";

	let tokenDisplay = "";
	if (props.tokenUsage) {
		const { used, allocated, percentage } = props.tokenUsage;
		tokenDisplay = `  Tokens: ${used.toLocaleString()} / ${allocated.toLocaleString()} (${percentage.toFixed(1)}%)`;
	} else if (props.currentPhase) {
		tokenDisplay = "  Tokens: --";
	}

	return `${tierColor(`[${tier}]`)}  ${chalk.white(model)}  ${meter}  ${modeColor(`[${mode}]`)}${phase}${hilMode}${tokenDisplay}${session}`;
}

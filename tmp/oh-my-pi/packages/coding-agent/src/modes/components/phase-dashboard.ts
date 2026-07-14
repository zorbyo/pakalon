/**
 * Phase dashboard component for Pakalon TUI.
 * Shows current phase (1-6) with progress bar, active subagent, and context usage.
 */
import chalk from "chalk";

// =============================================================================
// Types
// =============================================================================

export type PhaseId = "phase-1" | "phase-2" | "phase-3" | "phase-4" | "phase-5" | "phase-6";

export interface PhaseDashboardState {
	currentPhase: PhaseId;
	mode: "HIL" | "YOLO";
	activeSubagent?: string;
	contextUsed: number;
	contextTotal: number;
	subagentsCompleted: number;
	subagentsTotal: number;
	errors: number;
	warnings: number;
}

// =============================================================================
// Constants
// =============================================================================

const PHASE_NAMES: Record<PhaseId, string> = {
	"phase-1": "Planning",
	"phase-2": "Wireframes",
	"phase-3": "Development",
	"phase-4": "Testing",
	"phase-5": "Deployment",
	"phase-6": "Documentation",
};

const PHASE_ICONS: Record<PhaseId, string> = {
	"phase-1": "📋",
	"phase-2": "🎨",
	"phase-3": "⚙️",
	"phase-4": "🔒",
	"phase-5": "🚀",
	"phase-6": "📚",
};

// =============================================================================
// Rendering
// =============================================================================

/**
 * Render the phase dashboard as a formatted string.
 */
export function renderPhaseDashboard(state: PhaseDashboardState): string {
	const lines: string[] = [];

	// Header
	const modeTag = state.mode === "HIL" ? chalk.bgBlue.white(" HIL ") : chalk.bgMagenta.white(" YOLO ");
	lines.push(`${chalk.bold("Pakalon Phase Dashboard")}  ${modeTag}`);
	lines.push("");

	// Phase progress
	const phases: PhaseId[] = ["phase-1", "phase-2", "phase-3", "phase-4", "phase-5", "phase-6"];
	const currentIdx = phases.indexOf(state.currentPhase);

	for (let i = 0; i < phases.length; i++) {
		const phase = phases[i];
		const name = PHASE_NAMES[phase];
		const icon = PHASE_ICONS[phase];

		let indicator: string;
		if (i < currentIdx) {
			indicator = chalk.green("✓");
		} else if (i === currentIdx) {
			indicator = chalk.yellow.bold("▶");
		} else {
			indicator = chalk.dim("○");
		}

		const label = i === currentIdx ? chalk.bold.white(name) : chalk.dim(name);
		lines.push(`  ${indicator} ${icon} ${label}`);
	}

	lines.push("");

	// Active subagent
	if (state.activeSubagent) {
		lines.push(`  ${chalk.bold("Active:")} ${chalk.cyan(state.activeSubagent)}`);
	}

	// Subagent progress
	if (state.subagentsTotal > 0) {
		const pct = Math.round((state.subagentsCompleted / state.subagentsTotal) * 100);
		const bar = renderProgressBar(pct, 20);
		lines.push(`  ${chalk.bold("Subagents:")} ${bar} ${state.subagentsCompleted}/${state.subagentsTotal}`);
	}

	// Context usage
	if (state.contextTotal > 0) {
		const pct = Math.round((state.contextUsed / state.contextTotal) * 100);
		const bar = renderProgressBar(pct, 20);
		const color = pct > 90 ? chalk.red : pct > 70 ? chalk.yellow : chalk.green;
		lines.push(
			`  ${chalk.bold("Context:")} ${color(bar)} ${pct}% (${formatTokens(state.contextUsed)}/${formatTokens(state.contextTotal)})`,
		);
	}

	// Errors/warnings
	if (state.errors > 0 || state.warnings > 0) {
		const parts: string[] = [];
		if (state.errors > 0) parts.push(chalk.red(`${state.errors} error(s)`));
		if (state.warnings > 0) parts.push(chalk.yellow(`${state.warnings} warning(s)`));
		lines.push(`  ${chalk.bold("Issues:")} ${parts.join(", ")}`);
	}

	return lines.join("\n");
}

/**
 * Render a compact phase indicator for the status line.
 */
export function renderCompactPhaseIndicator(state: PhaseDashboardState): string {
	const phaseNum = state.currentPhase.replace("phase-", "");
	const subagent = state.activeSubagent ? ` S:${state.activeSubagent.slice(0, 10)}` : "";
	return chalk.dim(`[P${phaseNum}${subagent}]`);
}

// =============================================================================
// Helpers
// =============================================================================

function renderProgressBar(percentage: number, width: number): string {
	const filled = Math.round((percentage / 100) * width);
	const empty = width - filled;
	const filledBar = "█".repeat(filled);
	const emptyBar = "░".repeat(empty);
	return `${chalk.cyan(filledBar)}${chalk.dim(emptyBar)}`;
}

function formatTokens(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
	return String(tokens);
}

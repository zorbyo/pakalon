/**
 * Phase progress TUI component.
 *
 * Renders a compact 6-phase progress bar showing current status of
 * each phase in the Pakalon SDLC pipeline. Used by the React-based
 * TUI overlays and the plain-text footer.
 */
import * as React from "react";

export type PhaseName = "phase-1" | "phase-2" | "phase-3" | "phase-4" | "phase-5" | "phase-6";
export type PhaseStatusValue = "pending" | "running" | "completed" | "failed" | "skipped";

export const ALL_PHASES: PhaseName[] = ["phase-1", "phase-2", "phase-3", "phase-4", "phase-5", "phase-6"];

const PHASE_LABELS: Record<PhaseName, string> = {
	"phase-1": "Planning",
	"phase-2": "Design",
	"phase-3": "Dev",
	"phase-4": "Testing",
	"phase-5": "Deploy",
	"phase-6": "Docs",
};

const PHASE_SHORT: Record<PhaseName, string> = {
	"phase-1": "P1",
	"phase-2": "P2",
	"phase-3": "P3",
	"phase-4": "P4",
	"phase-5": "P5",
	"phase-6": "P6",
};

const STATUS_COLORS: Record<PhaseStatusValue, string> = {
	pending: "gray",
	running: "cyan",
	completed: "green",
	failed: "red",
	skipped: "yellow",
};

const STATUS_ICONS: Record<PhaseStatusValue, string> = {
	pending: " ",
	running: "\u25b6",
	completed: "\u2713",
	failed: "\u2717",
	skipped: "\u25cb",
};

export interface PhaseProgressProps {
	currentPhase: PhaseName | null;
	phaseStatuses: Partial<Record<PhaseName, PhaseStatusValue>>;
}

function formatPhaseLabel(phase: PhaseName, status: PhaseStatusValue): string {
	const icon = STATUS_ICONS[status];
	const label = PHASE_SHORT[phase];
	if (status === "running") {
		return `${icon}${label}:${PHASE_LABELS[phase]}`;
	}
	return `${label}`;
}

function completedCount(phaseStatuses: Partial<Record<PhaseName, PhaseStatusValue>>): number {
	return ALL_PHASES.filter(p => phaseStatuses[p] === "completed").length;
}

/**
 * Pure-string render path for non-React contexts.
 */
export function renderPhaseProgress(
	currentPhase: PhaseName | null,
	phaseStatuses: Partial<Record<PhaseName, PhaseStatusValue>>,
): string {
	const segments: string[] = [];
	for (const phase of ALL_PHASES) {
		const status = phaseStatuses[phase] || "pending";
		const display = formatPhaseLabel(phase, status);
		const color = STATUS_COLORS[status];
		const colorCode: Record<string, string> = {
			gray: "90",
			cyan: "36",
			green: "32",
			red: "31",
			yellow: "33",
		};
		const code = colorCode[color] || "0";
		const marker = phase === currentPhase ? " \u25b6" : "";
		segments.push(`\x1b[${code}m[${display}]\x1b[0m${marker}`);
	}

	const done = completedCount(phaseStatuses);
	const total = ALL_PHASES.length;
	const pct = Math.round((done / total) * 100);
	const progress = `Progress: ${done}/${total} (${pct}%)`;

	return `${segments.join(" ")}\n${progress}`;
}

export function PhaseProgress({ currentPhase, phaseStatuses }: PhaseProgressProps): React.ReactElement {
	const segments: React.ReactElement[] = [];

	for (const phase of ALL_PHASES) {
		const status = phaseStatuses[phase] || "pending";
		const label = formatPhaseLabel(phase, status);
		const color = STATUS_COLORS[status];
		const isCurrent = phase === currentPhase;

		segments.push(
			React.createElement(
				"text",
				{
					key: phase,
					color,
					bold: isCurrent,
				},
				isCurrent ? ` \u25b6[${label}]` : ` [${label}]`,
			),
		);
	}

	const done = completedCount(phaseStatuses);
	const total = ALL_PHASES.length;

	return React.createElement(
		"box",
		{ flexDirection: "row" },
		...segments,
		React.createElement("text", { color: "white" }, `  ${done}/${total}`),
	);
}

/**
 * Phase orchestrator for Pakalon's 6-phase SDLC workflow.
 * Full state machine with HIL/YOLO transitions, rollback, and token budget tracking.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export type Phase = "idle" | "phase-1" | "phase-2" | "phase-3" | "phase-4" | "phase-5" | "phase-6" | "completed";

export type Mode = "HIL" | "YOLO";

export type PhaseStatus =
	| "pending"
	| "running"
	| "awaiting_approval"
	| "approved"
	| "rejected"
	| "completed"
	| "failed"
	| "skipped";

export interface PhaseState {
	status: PhaseStatus;
	startedAt?: string;
	completedAt?: string;
	approvalRequestedAt?: string;
	approvalResponseAt?: string;
	rejectionReason?: string;
	error?: string;
	tokensUsed: number;
	filesModified: string[];
}

export interface ProjectState {
	phase: Phase;
	mode: Mode;
	projectDir: string;
	contextBudget: number;
	phaseStartTime?: string;
	phaseEndTime?: string;
	approvals: Record<string, boolean>;
	phases: Record<Phase, PhaseState>;
	rollbackHistory: RollbackPoint[];
	version: number;
}

export interface RollbackPoint {
	phase: Phase;
	timestamp: string;
	stateSnapshot: string;
	description: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const STATE_FILE = "state.json";
const PHASES_ORDER: Phase[] = ["phase-1", "phase-2", "phase-3", "phase-4", "phase-5", "phase-6"];

const PHASE_NAMES: Record<Phase, string> = {
	idle: "Idle",
	"phase-1": "Planning & Requirements",
	"phase-2": "Wireframes",
	"phase-3": "Development",
	"phase-4": "Testing & QA",
	"phase-5": "Deployment",
	"phase-6": "Documentation",
	completed: "Completed",
};

const PHASE_TOKEN_ALLOCATIONS: Record<Phase, number> = {
	idle: 0,
	"phase-1": 25600,
	"phase-2": 19200,
	"phase-3": 38400,
	"phase-4": 19200,
	"phase-5": 6400,
	"phase-6": 6400,
	completed: 0,
};

const DEFAULT_CONTEXT_BUDGET = 128000;

// ═══════════════════════════════════════════════════════════════════════════════
// File I/O
// ═══════════════════════════════════════════════════════════════════════════════

function getStatePath(projectDir: string): string {
	return path.join(projectDir, ".pakalon-agents", STATE_FILE);
}

function readState(projectDir: string): ProjectState | null {
	try {
		const raw = fs.readFileSync(getStatePath(projectDir), "utf-8");
		const parsed = JSON.parse(raw) as ProjectState;
		// Ensure all required fields exist
		if (!parsed.phases) {
			parsed.phases = createDefaultPhases();
		}
		if (!parsed.rollbackHistory) {
			parsed.rollbackHistory = [];
		}
		if (typeof parsed.version !== "number") {
			parsed.version = 1;
		}
		return parsed;
	} catch {
		return null;
	}
}

function writeState(projectDir: string, state: ProjectState): void {
	state.version += 1;
	const dir = path.join(projectDir, ".pakalon-agents");
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	fs.writeFileSync(getStatePath(projectDir), JSON.stringify(state, null, 2));
	logger.debug("State updated", { phase: state.phase, mode: state.mode, version: state.version });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Default factories
// ═══════════════════════════════════════════════════════════════════════════════

function createDefaultPhaseState(): PhaseState {
	return { status: "pending", tokensUsed: 0, filesModified: [] };
}

function createDefaultPhases(): Record<Phase, PhaseState> {
	return {
		idle: createDefaultPhaseState(),
		"phase-1": createDefaultPhaseState(),
		"phase-2": createDefaultPhaseState(),
		"phase-3": createDefaultPhaseState(),
		"phase-4": createDefaultPhaseState(),
		"phase-5": createDefaultPhaseState(),
		"phase-6": createDefaultPhaseState(),
		completed: createDefaultPhaseState(),
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// Core state management
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Initialize the project state.
 */
export function initializeState(
	projectDir: string,
	mode: Mode,
	contextBudget: number = DEFAULT_CONTEXT_BUDGET,
): ProjectState {
	const state: ProjectState = {
		phase: "phase-1",
		mode,
		projectDir,
		contextBudget,
		approvals: {},
		phases: createDefaultPhases(),
		rollbackHistory: [],
		version: 0,
		phaseStartTime: new Date().toISOString(),
	};

	// Mark phase-1 as running
	state.phases["phase-1"].status = "running";
	state.phases["phase-1"].startedAt = state.phaseStartTime;

	writeState(projectDir, state);
	logger.info("State initialized", { mode, contextBudget });
	return state;
}

/**
 * Get the current project state.
 */
export function getState(projectDir: string): ProjectState | null {
	return readState(projectDir);
}

/**
 * Get the current phase.
 */
export function getCurrentPhase(projectDir: string): Phase {
	const state = readState(projectDir);
	return state?.phase ?? "idle";
}

/**
 * Get the current mode.
 */
export function getCurrentMode(projectDir: string): Mode {
	const state = readState(projectDir);
	return state?.mode ?? "HIL";
}

/**
 * Get phase display name.
 */
export function getPhaseName(phase: Phase): string {
	return PHASE_NAMES[phase];
}

/**
 * Get token allocation for a phase.
 */
export function getPhaseTokenAllocation(phase: Phase): number {
	return PHASE_TOKEN_ALLOCATIONS[phase];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase transitions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Start a phase. For phase-3 (Development) the orchestrator
 * auto-triggers a Docker sandbox if the project is "large" (per the
 * size/file-count thresholds in `sandbox/policy.ts`) so the first
 * run + test are isolated. The sandbox is torn down only after phase-4
 * reports a clean review score (see `policy.markSandboxEligible`).
 */
export async function startPhaseAsync(projectDir: string, phase: Phase): Promise<boolean> {
	const ok = startPhase(projectDir, phase);
	if (!ok) return false;
	if (phase === "phase-3") {
		try {
			const { ensureSandboxForProject } = await import("./sandbox/policy");
			const policy = await ensureSandboxForProject(projectDir);
			if (policy.enabled) {
				logger.info("phase-3: sandbox auto-triggered", { containerId: policy.containerId, reason: policy.reason });
			}
		} catch (err) {
			logger.warn("phase-3: sandbox auto-trigger failed", { err });
		}
	}
	return true;
}

/**
 * Start a phase (synchronous). Sandbox auto-trigger is not invoked in
 * the sync variant; use `startPhaseAsync` for the full flow.
 */
export function startPhase(projectDir: string, phase: Phase): boolean {
	const state = readState(projectDir);
	if (!state) return false;

	// Validate transition
	if (!canTransition(state.phase, phase)) {
		logger.warn("Invalid phase transition", { from: state.phase, to: phase });
		return false;
	}

	// Mark current phase as completed if running
	const currentPhaseState = state.phases[state.phase];
	if (currentPhaseState.status === "running") {
		currentPhaseState.status = "completed";
		currentPhaseState.completedAt = new Date().toISOString();
	}

	// Start new phase
	state.phase = phase;
	state.phaseStartTime = new Date().toISOString();
	const newPhaseState = state.phases[phase];
	newPhaseState.status = "running";
	newPhaseState.startedAt = state.phaseStartTime;
	newPhaseState.tokensUsed = 0;
	newPhaseState.filesModified = [];

	writeState(projectDir, state);
	logger.info("Phase started", { phase, name: PHASE_NAMES[phase] });
	return true;
}

/**
 * Advance to the next phase.
 */
export function advancePhase(projectDir: string): Phase | null {
	const state = readState(projectDir);
	if (!state) return null;

	const idx = PHASES_ORDER.indexOf(state.phase);
	if (idx < 0 || idx >= PHASES_ORDER.length - 1) {
		state.phase = "completed";
		state.phaseEndTime = new Date().toISOString();
		writeState(projectDir, state);
		return null;
	}

	// Mark current phase as completed
	const currentPhaseState = state.phases[state.phase];
	currentPhaseState.status = "completed";
	currentPhaseState.completedAt = new Date().toISOString();

	// Advance
	const nextPhase = PHASES_ORDER[idx + 1]!;
	state.phase = nextPhase;
	state.phaseStartTime = new Date().toISOString();
	const nextPhaseState = state.phases[nextPhase];
	nextPhaseState.status = "running";
	nextPhaseState.startedAt = state.phaseStartTime;

	writeState(projectDir, state);
	logger.info("Advanced to phase", { phase: nextPhase, name: PHASE_NAMES[nextPhase] });
	return nextPhase;
}

/**
 * Check if a transition is valid.
 */
function canTransition(from: Phase, to: Phase): boolean {
	// Can always go to idle
	if (to === "idle") return true;

	// Can always go to completed if in phase-6
	if (to === "completed" && from === "phase-6") return true;

	// Can go forward one phase
	const fromIdx = PHASES_ORDER.indexOf(from);
	const toIdx = PHASES_ORDER.indexOf(to);
	if (toIdx === fromIdx + 1) return true;

	// Can jump to any phase (for /phase-X commands)
	if (toIdx >= 0) return true;

	return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HIL/YOLO mode management
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Switch mode (HIL ↔ YOLO).
 */
export function switchMode(projectDir: string, newMode: Mode): boolean {
	const state = readState(projectDir);
	if (!state) return false;

	const oldMode = state.mode;
	state.mode = newMode;

	// If switching to YOLO, auto-approve all pending phases
	if (newMode === "YOLO" && oldMode === "HIL") {
		for (const phase of PHASES_ORDER) {
			const phaseState = state.phases[phase];
			if (phaseState.status === "awaiting_approval") {
				phaseState.status = "completed";
				phaseState.approvalResponseAt = new Date().toISOString();
				state.approvals[phase] = true;
			}
		}
		logger.info("YOLO mode: auto-approved all pending phases");
	}

	writeState(projectDir, state);
	logger.info("Mode switched", { from: oldMode, to: newMode });
	return true;
}

/**
 * Check if we're in YOLO mode.
 */
export function isYoloMode(projectDir: string): boolean {
	return getCurrentMode(projectDir) === "YOLO";
}

// ═══════════════════════════════════════════════════════════════════════════════
// Approval management
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Request approval for a phase.
 */
export function requestApproval(projectDir: string, phase: Phase): boolean {
	const state = readState(projectDir);
	if (!state) return false;

	// In YOLO mode, auto-approve
	if (state.mode === "YOLO") {
		state.approvals[phase] = true;
		writeState(projectDir, state);
		return true;
	}

	// In HIL mode, request approval
	const phaseState = state.phases[phase];
	phaseState.status = "awaiting_approval";
	phaseState.approvalRequestedAt = new Date().toISOString();

	writeState(projectDir, state);
	logger.info("Approval requested", { phase });
	return true;
}

/**
 * Set approval for the current phase.
 */
export function approvePhase(projectDir: string, phase: Phase, approved: boolean, reason?: string): boolean {
	const state = readState(projectDir);
	if (!state) return false;

	state.approvals[phase] = approved;
	const phaseState = state.phases[phase];
	phaseState.approvalResponseAt = new Date().toISOString();

	if (approved) {
		phaseState.status = "completed";
		logger.info("Phase approved", { phase });
	} else {
		phaseState.status = "rejected";
		phaseState.rejectionReason = reason ?? "Rejected by user";
		logger.info("Phase rejected", { phase, reason });
	}

	writeState(projectDir, state);
	return true;
}

/**
 * Check if the current phase is approved.
 */
export function isPhaseApproved(projectDir: string, phase: Phase): boolean {
	const state = readState(projectDir);
	if (!state) return false;
	return state.approvals[phase] || false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase management
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Jump to a specific phase (for /phase-X commands).
 */
export function jumpToPhase(projectDir: string, phase: Phase): boolean {
	const state = readState(projectDir);
	if (!state) return false;

	// Mark current phase as completed
	const currentPhaseState = state.phases[state.phase];
	if (currentPhaseState.status === "running") {
		currentPhaseState.status = "completed";
		currentPhaseState.completedAt = new Date().toISOString();
	}

	// Jump to target phase
	state.phase = phase;
	state.phaseStartTime = new Date().toISOString();
	const targetPhaseState = state.phases[phase];
	targetPhaseState.status = "running";
	targetPhaseState.startedAt = state.phaseStartTime;

	writeState(projectDir, state);
	logger.info("Jumped to phase", { phase, name: PHASE_NAMES[phase] });
	return true;
}

/**
 * Skip a phase.
 */
export function skipPhase(projectDir: string, phase: Phase): boolean {
	const state = readState(projectDir);
	if (!state) return false;

	const phaseState = state.phases[phase];
	phaseState.status = "skipped";
	phaseState.completedAt = new Date().toISOString();

	// Auto-advance to next phase
	const idx = PHASES_ORDER.indexOf(phase);
	if (idx >= 0 && idx < PHASES_ORDER.length - 1) {
		const nextPhase = PHASES_ORDER[idx + 1]!;
		state.phase = nextPhase;
		state.phaseStartTime = new Date().toISOString();
		const nextPhaseState = state.phases[nextPhase];
		nextPhaseState.status = "running";
		nextPhaseState.startedAt = state.phaseStartTime;
	}

	writeState(projectDir, state);
	logger.info("Phase skipped", { phase });
	return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Token budget management
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Update the context budget.
 */
export function updateContextBudget(projectDir: string, budget: number): void {
	const state = readState(projectDir);
	if (!state) return;
	state.contextBudget = budget;
	writeState(projectDir, state);
}

/**
 * Log token usage for a phase.
 */
export function logTokenUsage(projectDir: string, phase: Phase, tokens: number): boolean {
	const state = readState(projectDir);
	if (!state) return false;

	const phaseState = state.phases[phase];
	phaseState.tokensUsed += tokens;

	// Check if over budget
	const allocation = PHASE_TOKEN_ALLOCATIONS[phase];
	if (phaseState.tokensUsed > allocation) {
		logger.warn("Phase over token budget", {
			phase,
			used: phaseState.tokensUsed,
			allocated: allocation,
		});
	}

	writeState(projectDir, state);
	return true;
}

/**
 * Get token usage for a phase.
 */
export function getTokenUsage(
	projectDir: string,
	phase: Phase,
): { used: number; allocated: number; percentage: number } {
	const state = readState(projectDir);
	if (!state) return { used: 0, allocated: 0, percentage: 0 };

	const phaseState = state.phases[phase];
	const allocated = PHASE_TOKEN_ALLOCATIONS[phase];
	const percentage = allocated > 0 ? (phaseState.tokensUsed / allocated) * 100 : 0;

	return { used: phaseState.tokensUsed, allocated, percentage };
}

/**
 * Check if phase is within token budget.
 */
export function isWithinTokenBudget(projectDir: string, phase: Phase): boolean {
	const usage = getTokenUsage(projectDir, phase);
	return usage.used <= usage.allocated;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Rollback management
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a rollback point.
 */
export function createRollbackPoint(projectDir: string, description: string): boolean {
	const state = readState(projectDir);
	if (!state) return false;

	const rollback: RollbackPoint = {
		phase: state.phase,
		timestamp: new Date().toISOString(),
		stateSnapshot: JSON.stringify(state),
		description,
	};

	state.rollbackHistory.push(rollback);

	// Keep only last 10 rollback points
	if (state.rollbackHistory.length > 10) {
		state.rollbackHistory = state.rollbackHistory.slice(-10);
	}

	writeState(projectDir, state);
	logger.info("Rollback point created", { phase: state.phase, description });
	return true;
}

/**
 * Rollback to the last rollback point.
 */
export function rollback(projectDir: string): boolean {
	const state = readState(projectDir);
	if (!state || state.rollbackHistory.length === 0) return false;

	const lastRollback = state.rollbackHistory.pop()!;
	const restoredState = JSON.parse(lastRollback.stateSnapshot) as ProjectState;

	// Keep the rollback history
	restoredState.rollbackHistory = state.rollbackHistory;

	writeState(projectDir, restoredState);
	logger.info("Rolled back to", { phase: lastRollback.phase, description: lastRollback.description });
	return true;
}

/**
 * Get rollback history.
 */
export function getRollbackHistory(projectDir: string): RollbackPoint[] {
	const state = readState(projectDir);
	return state?.rollbackHistory ?? [];
}

// ═══════════════════════════════════════════════════════════════════════════════
// File tracking
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Log a file modification for a phase.
 */
export function logFileModification(projectDir: string, phase: Phase, filePath: string): boolean {
	const state = readState(projectDir);
	if (!state) return false;

	const phaseState = state.phases[phase];
	if (!phaseState.filesModified.includes(filePath)) {
		phaseState.filesModified.push(filePath);
	}

	writeState(projectDir, state);
	return true;
}

/**
 * Get files modified in a phase.
 */
export function getFilesModified(projectDir: string, phase: Phase): string[] {
	const state = readState(projectDir);
	if (!state) return [];
	return state.phases[phase].filesModified;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Reporting
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a summary report of the project state.
 */
export function generateSummaryReport(projectDir: string): string {
	const state = readState(projectDir);
	if (!state) return "No project state found.";

	const lines = [
		"Pakalon Project Summary",
		"═══════════════════════════════════════",
		`Current Phase: ${PHASE_NAMES[state.phase]} (${state.phase})`,
		`Mode: ${state.mode}`,
		`Context Budget: ${state.contextBudget.toLocaleString()} tokens`,
		`Version: ${state.version}`,
		"",
		"Phase Status:",
	];

	for (const phase of PHASES_ORDER) {
		const phaseState = state.phases[phase];
		const icon =
			phaseState.status === "completed"
				? "✓"
				: phaseState.status === "running"
					? "→"
					: phaseState.status === "failed"
						? "✗"
						: "○";
		const tokens = phaseState.tokensUsed > 0 ? ` (${phaseState.tokensUsed.toLocaleString()} tokens)` : "";
		lines.push(`  ${icon} ${PHASE_NAMES[phase]}: ${phaseState.status}${tokens}`);
	}

	// Token usage summary
	const totalTokens = Object.values(state.phases).reduce((sum, p) => sum + p.tokensUsed, 0);
	const totalAllocated = Object.values(PHASE_TOKEN_ALLOCATIONS).reduce((sum, a) => sum + a, 0);
	lines.push("");
	lines.push(`Total Tokens Used: ${totalTokens.toLocaleString()} / ${totalAllocated.toLocaleString()}`);

	// Rollback history
	if (state.rollbackHistory.length > 0) {
		lines.push("");
		lines.push(`Rollback Points: ${state.rollbackHistory.length}`);
	}

	return lines.join("\n");
}

/**
 * Get phase progress (0-100%).
 */
export function getPhaseProgress(projectDir: string): number {
	const state = readState(projectDir);
	if (!state) return 0;

	const idx = PHASES_ORDER.indexOf(state.phase);
	if (idx < 0) return 0;

	// Base progress from completed phases
	const baseProgress = (idx / PHASES_ORDER.length) * 100;

	// Add progress within current phase based on token usage
	const usage = getTokenUsage(projectDir, state.phase);
	const phaseProgress = usage.percentage > 0 ? (usage.percentage / 100) * (100 / PHASES_ORDER.length) : 0;

	return Math.min(100, Math.round(baseProgress + phaseProgress));
}

/**
 * Get overall project progress (0-100%).
 */
export function getOverallProgress(projectDir: string): number {
	const state = readState(projectDir);
	if (!state) return 0;

	if (state.phase === "completed") return 100;

	const idx = PHASES_ORDER.indexOf(state.phase);
	if (idx < 0) return 0;

	// Count completed phases
	const completedPhases = PHASES_ORDER.filter(p => state.phases[p].status === "completed").length;

	// Add progress for current phase
	const currentPhaseProgress = getPhaseProgress(projectDir);
	const currentPhaseWeight = 100 / PHASES_ORDER.length;
	const currentPhaseContribution = (currentPhaseProgress / 100) * currentPhaseWeight;

	return Math.min(100, Math.round((completedPhases / PHASES_ORDER.length) * 100 + currentPhaseContribution));
}

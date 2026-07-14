import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import type { Mode, PhaseId, PhaseState, ProjectState, RollbackPoint } from "./types";
import { PHASE_NAMES, PHASE_TOKEN_ALLOCATIONS, PHASES_ORDER } from "./types";

const STATE_FILE = "state.json";

function getStatePath(projectDir: string): string {
	return path.join(projectDir, ".pakalon-agents", STATE_FILE);
}

function createDefaultPhaseState(): PhaseState {
	return { status: "pending", tokensUsed: 0, filesModified: [] };
}

function createDefaultPhases(): Record<PhaseId, PhaseState> {
	const phases = {} as Record<PhaseId, PhaseState>;
	for (const p of [...PHASES_ORDER, "idle", "completed"] as PhaseId[]) {
		phases[p] = createDefaultPhaseState();
	}
	return phases;
}

function readState(projectDir: string): ProjectState | null {
	try {
		const raw = fs.readFileSync(getStatePath(projectDir), "utf-8");
		const parsed = JSON.parse(raw) as ProjectState;
		if (!parsed.phases) parsed.phases = createDefaultPhases();
		if (!parsed.rollbackHistory) parsed.rollbackHistory = [];
		if (typeof parsed.version !== "number") parsed.version = 1;
		return parsed;
	} catch {
		return null;
	}
}

function writeState(projectDir: string, state: ProjectState): void {
	state.version += 1;
	const dir = path.join(projectDir, ".pakalon-agents");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(getStatePath(projectDir), JSON.stringify(state, null, 2));
	logger.debug("State updated", { phase: state.phase, mode: state.mode, version: state.version });
}

function canTransition(from: PhaseId, to: PhaseId): boolean {
	if (to === "idle") return true;
	if (to === "completed" && from === "phase-6") return true;
	const fromIdx = PHASES_ORDER.indexOf(from);
	const toIdx = PHASES_ORDER.indexOf(to);
	if (toIdx === fromIdx + 1) return true;
	if (toIdx >= 0) return true;
	return false;
}

export function initializeState(projectDir: string, mode: Mode, contextBudget = 128000): ProjectState {
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
	state.phases["phase-1"].status = "running";
	state.phases["phase-1"].startedAt = state.phaseStartTime;
	writeState(projectDir, state);
	logger.info("State initialized", { mode, contextBudget });
	return state;
}

export function getState(projectDir: string): ProjectState | null {
	return readState(projectDir);
}

export function getCurrentPhase(projectDir: string): PhaseId {
	return readState(projectDir)?.phase ?? "idle";
}

export function getCurrentMode(projectDir: string): Mode {
	return readState(projectDir)?.mode ?? "HIL";
}

export function startPhase(projectDir: string, phase: PhaseId): boolean {
	const state = readState(projectDir);
	if (!state) return false;
	if (!canTransition(state.phase, phase)) {
		logger.warn("Invalid phase transition", { from: state.phase, to: phase });
		return false;
	}
	const currentPhaseState = state.phases[state.phase];
	if (currentPhaseState.status === "running") {
		currentPhaseState.status = "completed";
		currentPhaseState.completedAt = new Date().toISOString();
	}
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

export function advancePhase(projectDir: string): PhaseId | null {
	const state = readState(projectDir);
	if (!state) return null;
	const idx = PHASES_ORDER.indexOf(state.phase);
	if (idx < 0 || idx >= PHASES_ORDER.length - 1) {
		state.phase = "completed";
		state.phaseEndTime = new Date().toISOString();
		writeState(projectDir, state);
		return null;
	}
	const currentPhaseState = state.phases[state.phase];
	currentPhaseState.status = "completed";
	currentPhaseState.completedAt = new Date().toISOString();
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

export function switchMode(projectDir: string, newMode: Mode): boolean {
	const state = readState(projectDir);
	if (!state) return false;
	const oldMode = state.mode;
	state.mode = newMode;
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

export function isYoloMode(projectDir: string): boolean {
	return getCurrentMode(projectDir) === "YOLO";
}

export function isHilMode(projectDir: string): boolean {
	return getCurrentMode(projectDir) === "HIL";
}

export function requestApproval(projectDir: string, phase: PhaseId): boolean {
	const state = readState(projectDir);
	if (!state) return false;
	if (state.mode === "YOLO") {
		state.approvals[phase] = true;
		writeState(projectDir, state);
		return true;
	}
	const phaseState = state.phases[phase];
	phaseState.status = "awaiting_approval";
	phaseState.approvalRequestedAt = new Date().toISOString();
	writeState(projectDir, state);
	logger.info("Approval requested", { phase });
	return true;
}

export function approvePhase(projectDir: string, phase: PhaseId, approved: boolean, reason?: string): boolean {
	const state = readState(projectDir);
	if (!state) return false;
	state.approvals[phase] = approved;
	const phaseState = state.phases[phase];
	phaseState.approvalResponseAt = new Date().toISOString();
	if (approved) {
		phaseState.status = "completed";
	} else {
		phaseState.status = "rejected";
		phaseState.rejectionReason = reason ?? "Rejected by user";
	}
	writeState(projectDir, state);
	return true;
}

export function isPhaseApproved(projectDir: string, phase: PhaseId): boolean {
	const state = readState(projectDir);
	if (!state) return false;
	return state.approvals[phase] ?? false;
}

export function jumpToPhase(projectDir: string, phase: PhaseId): boolean {
	const state = readState(projectDir);
	if (!state) return false;
	const currentPhaseState = state.phases[state.phase];
	if (currentPhaseState.status === "running") {
		currentPhaseState.status = "completed";
		currentPhaseState.completedAt = new Date().toISOString();
	}
	state.phase = phase;
	state.phaseStartTime = new Date().toISOString();
	const targetPhaseState = state.phases[phase];
	targetPhaseState.status = "running";
	targetPhaseState.startedAt = state.phaseStartTime;
	writeState(projectDir, state);
	logger.info("Jumped to phase", { phase, name: PHASE_NAMES[phase] });
	return true;
}

export function skipPhase(projectDir: string, phase: PhaseId): boolean {
	const state = readState(projectDir);
	if (!state) return false;
	const phaseState = state.phases[phase];
	phaseState.status = "skipped";
	phaseState.completedAt = new Date().toISOString();
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

export function logTokenUsage(projectDir: string, phase: PhaseId, tokens: number): boolean {
	const state = readState(projectDir);
	if (!state) return false;
	const phaseState = state.phases[phase];
	phaseState.tokensUsed += tokens;
	writeState(projectDir, state);
	return true;
}

export function getTokenUsage(
	projectDir: string,
	phase: PhaseId,
): { used: number; allocated: number; percentage: number } {
	const state = readState(projectDir);
	if (!state) return { used: 0, allocated: 0, percentage: 0 };
	const phaseState = state.phases[phase];
	const allocated = PHASE_TOKEN_ALLOCATIONS[phase];
	const percentage = allocated > 0 ? (phaseState.tokensUsed / allocated) * 100 : 0;
	return { used: phaseState.tokensUsed, allocated, percentage };
}

export function logFileModification(projectDir: string, phase: PhaseId, filePath: string): boolean {
	const state = readState(projectDir);
	if (!state) return false;
	const phaseState = state.phases[phase];
	if (!phaseState.filesModified.includes(filePath)) {
		phaseState.filesModified.push(filePath);
	}
	writeState(projectDir, state);
	return true;
}

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
	if (state.rollbackHistory.length > 10) {
		state.rollbackHistory = state.rollbackHistory.slice(-10);
	}
	writeState(projectDir, state);
	logger.info("Rollback point created", { phase: state.phase, description });
	return true;
}

export function rollback(projectDir: string): boolean {
	const state = readState(projectDir);
	if (!state || state.rollbackHistory.length === 0) return false;
	const lastRollback = state.rollbackHistory.pop()!;
	const restoredState = JSON.parse(lastRollback.stateSnapshot) as ProjectState;
	restoredState.rollbackHistory = state.rollbackHistory;
	writeState(projectDir, restoredState);
	logger.info("Rolled back to", { phase: lastRollback.phase, description: lastRollback.description });
	return true;
}

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
		const ps = state.phases[phase];
		const icon = ps.status === "completed" ? "✓" : ps.status === "running" ? "→" : ps.status === "failed" ? "✗" : "○";
		const tokens = ps.tokensUsed > 0 ? ` (${ps.tokensUsed.toLocaleString()} tokens)` : "";
		lines.push(`  ${icon} ${PHASE_NAMES[phase]}: ${ps.status}${tokens}`);
	}
	const totalTokens = Object.values(state.phases).reduce((sum, p) => sum + p.tokensUsed, 0);
	lines.push("");
	lines.push(`Total Tokens Used: ${totalTokens.toLocaleString()}`);
	return lines.join("\n");
}

export function getPhaseProgress(projectDir: string): number {
	const state = readState(projectDir);
	if (!state) return 0;
	const idx = PHASES_ORDER.indexOf(state.phase);
	if (idx < 0) return 0;
	return Math.round((idx / PHASES_ORDER.length) * 100);
}

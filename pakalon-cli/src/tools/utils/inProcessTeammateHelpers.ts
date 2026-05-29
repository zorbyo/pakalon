/**
 * In-process teammate helpers for spawning and managing teammates
 * that run within the same Node.js process using AsyncLocalStorage.
 */

import { formatAgentId } from "@/utils/agentId.js";
import { getCwd } from "@/utils/cwd.js";
import { logForDebugging } from "@/utils/debug.js";
import { errorMessage } from "@/utils/errors.js";

export interface InProcessTeammateConfig {
	name: string;
	teamName: string;
	prompt: string;
	color?: string;
	planModeRequired?: boolean;
	model?: string;
	agentType?: string;
}

export interface InProcessTeammateResult {
	success: boolean;
	taskId?: string;
	teammateContext?: Record<string, unknown>;
	abortController?: AbortController;
	error?: string;
}

export interface InProcessTeammateIdentity {
	agentId: string;
	agentName: string;
	teamName: string;
	color?: string;
	planModeRequired: boolean;
	parentSessionId?: string;
}

export interface InProcessTeammateTaskState {
	type: "in_process_teammate";
	status: "running" | "completed" | "failed" | "cancelled";
	identity: InProcessTeammateIdentity;
	prompt: string;
	abortController: AbortController;
	awaitingPlanApproval: boolean;
	permissionMode: string;
	isIdle: boolean;
	shutdownRequested: boolean;
	lastReportedToolCount: number;
	lastReportedTokenCount: number;
	pendingUserMessages: string[];
}

export function createTeammateIdentity(name: string, teamName: string, color?: string, planModeRequired?: boolean): InProcessTeammateIdentity {
	return {
		agentId: formatAgentId(name, teamName),
		agentName: name,
		teamName,
		color,
		planModeRequired: planModeRequired ?? false,
	};
}

export function createTeammateTaskState(
	taskId: string,
	identity: InProcessTeammateIdentity,
	prompt: string,
): InProcessTeammateTaskState {
	return {
		type: "in_process_teammate",
		status: "running",
		identity,
		prompt,
		abortController: new AbortController(),
		awaitingPlanApproval: false,
		permissionMode: identity.planModeRequired ? "plan" : "default",
		isIdle: false,
		shutdownRequested: false,
		lastReportedToolCount: 0,
		lastReportedTokenCount: 0,
		pendingUserMessages: [],
	};
}

export function getTeammateTaskState(taskId: string, appState: Record<string, unknown>): InProcessTeammateTaskState | null {
	try {
		const tasks = appState.tasks as Record<string, unknown> | undefined;
		if (tasks && tasks[taskId]) {
			return tasks[taskId] as InProcessTeammateTaskState;
		}
	} catch {
		// State not available
	}
	return null;
}

export function updateTeammateTaskState(
	taskId: string,
	updates: Partial<InProcessTeammateTaskState>,
	setAppState: (updater: (prev: Record<string, unknown>) => Record<string, unknown>) => void,
): void {
	setAppState(prev => {
		const tasks = { ...(prev.tasks as Record<string, unknown> | {}) };
		const task = tasks[taskId] as InProcessTeammateTaskState | undefined;
		if (task) {
			tasks[taskId] = { ...task, ...updates };
		}
		return { ...prev, tasks };
	});
}

export function cancelTeammateTask(
	taskId: string,
	setAppState: (updater: (prev: Record<string, unknown>) => Record<string, unknown>) => void,
): boolean {
	const task = getTeammateTaskState(taskId, (globalThis as Record<string, unknown>).__appState ?? {});
	if (task?.abortController) {
		task.abortController.abort();
		updateTeammateTaskState(taskId, { status: "cancelled" }, setAppState);
		logForDebugging(`[InProcessTeammateHelpers] Cancelled task ${taskId}`);
		return true;
	}
	return false;
}

export function formatTeammateStatus(task: InProcessTeammateTaskState): string {
	const { identity, status, prompt, isIdle, shutdownRequested } = task;
	const idleStr = isIdle ? " (idle)" : "";
	const shutdownStr = shutdownRequested ? " (shutdown requested)" : "";
	const promptPreview = prompt.length > 60 ? `${prompt.slice(0, 60)}...` : prompt;

	return `${identity.agentName} [${status}]${idleStr}${shutdownStr}: ${promptPreview}`;
}

export function listTeammateTasks(appState: Record<string, unknown>): InProcessTeammateTaskState[] {
	const results: InProcessTeammateTaskState[] = [];
	try {
		const tasks = appState.tasks as Record<string, InProcessTeammateTaskState> | undefined;
		if (tasks) {
			for (const task of Object.values(tasks)) {
				if (task?.type === "in_process_teammate") {
					results.push(task);
				}
			}
		}
	} catch (error) {
		logForDebugging(`[InProcessTeammateHelpers] Error listing tasks: ${errorMessage(error)}`);
	}
	return results;
}

export function findTeammateByAgentId(agentId: string, appState: Record<string, unknown>): InProcessTeammateTaskState | null {
	try {
		const tasks = appState.tasks as Record<string, InProcessTeammateTaskState> | undefined;
		if (tasks) {
			for (const task of Object.values(tasks)) {
				if (task?.type === "in_process_teammate" && task.identity.agentId === agentId) {
					return task;
				}
			}
		}
	} catch {
		// State not available
	}
	return null;
}

export function findTeammateByName(name: string, appState: Record<string, unknown>): InProcessTeammateTaskState | null {
	try {
		const tasks = appState.tasks as Record<string, InProcessTeammateTaskState> | undefined;
		if (tasks) {
			for (const task of Object.values(tasks)) {
				if (task?.type === "in_process_teammate" && task.identity.agentName.toLowerCase() === name.toLowerCase()) {
					return task;
				}
			}
		}
	} catch {
		// State not available
	}
	return null;
}

export function getTeammateColor(agentId: string): string {
	const colors = ["blue", "cyan", "green", "magenta", "red", "yellow", "gray"];
	let hash = 0;
	for (let i = 0; i < agentId.length; i++) {
		hash = agentId.charCodeAt(i) + ((hash << 5) - hash);
	}
	return colors[Math.abs(hash) % colors.length];
}

export function generateTeammateTaskId(): string {
	return `in_process_teammate_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

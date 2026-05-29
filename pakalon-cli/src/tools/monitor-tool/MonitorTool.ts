import { z } from 'zod';
import { buildTool, type ToolDef, type ToolCallProgress, type ToolProgress } from '../tool-types.js';
import { lazySchema } from '../../utils/lazySchema.js';
import { sleep } from '../../utils/sleep.js';
import {
	MONITOR_TOOL_NAME,
	MONITOR_TOOL_ALIASES,
	MONITOR_SESSION_PREFIX,
	DEFAULT_STREAM_INTERVAL,
	PROGRESS_STATES,
	isTerminalStatus,
	type TerminalStatus,
} from './constants.js';
import { getMonitorToolPrompt, getMonitorToolDescription } from './prompt.js';
import type {
	MonitorInput,
	MonitorOutput,
	MonitorStreamUpdate,
	MonitorToolResult,
	MonitorSession,
	MonitorStatus,
} from './types.js';

const inputSchema = lazySchema(() =>
	z.strictObject({
		taskId: z.string().describe('The task ID to monitor'),
		stream: z.boolean().optional().default(false).describe('Enable output streaming'),
		streamInterval: z
			.number()
			.min(100)
			.max(60000)
			.optional()
			.default(500)
			.describe('Stream update interval in ms'),
		includeHistory: z.boolean().optional().default(false).describe('Include historical output'),
		progress: z.boolean().optional().default(true).describe('Report progress updates'),
	}),
);

type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
	z.object({
		success: z.boolean(),
		monitor: z.object({
			taskId: z.string(),
			status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
			type: z.string(),
			description: z.string(),
			progress: z.number(),
			output: z.string(),
			exitCode: z.number().nullable().optional(),
			error: z.string().optional(),
			result: z.string().optional(),
			duration: z.number().optional(),
			monitorSessionId: z.string().optional(),
		}),
		updates: z
			.array(
				z.object({
					type: z.enum(['output', 'progress', 'status', 'error', 'complete']),
					data: z.union([z.string(), z.number()]),
					timestamp: z.number(),
				}),
			)
			.optional(),
	}),
);

type OutputSchema = ReturnType<typeof outputSchema>;

type Output = z.infer<OutputSchema>;

const activeSessions: Map<string, MonitorSession> = new Map();

function createMonitorSession(taskId: string): MonitorSession {
	const sessionId = `${MONITOR_SESSION_PREFIX}${taskId}-${Date.now()}`;
	const session: MonitorSession = {
		id: sessionId,
		taskId,
		startTime: Date.now(),
		lastUpdate: Date.now(),
		status: 'active',
		outputBuffer: [],
		progress: 0,
	};
	activeSessions.set(sessionId, session);
	return session;
}

function getTaskFromState(
	taskId: string,
): {
	status: string;
	type?: string;
	description?: string;
	createdAt?: number;
	startedAt?: number;
	endedAt?: number;
	result?: string;
	error?: string;
	output?: string;
} | null {
	try {
		const state = globalThis.__appState;
		if (state?.tasks?.[taskId]) {
			return state.tasks[taskId];
		}
	} catch {
		// State not available
	}
	return null;
}

function getTaskOutput(taskId: string): string {
	try {
		const storedOutput = globalThis.__taskOutputs?.[taskId];
		if (storedOutput) {
			return storedOutput;
		}
	} catch {
		// Task outputs not available
	}
	return '';
}

function calculateProgress(status: string, createdAt?: number, startedAt?: number, endedAt?: number): number {
	if (status === 'pending') return 0;
	if (status === 'running' || status === 'in_progress') {
		if (startedAt) {
			const elapsed = Date.now() - startedAt;
			return Math.min(90, Math.floor((elapsed / 1000) * 10));
		}
		return 50;
	}
	if (isTerminalStatus(status as TerminalStatus)) {
		return 100;
	}
	return 0;
}

async function waitForTaskCompletion(
	taskId: string,
	timeoutMs: number,
	abortController?: AbortController,
): Promise<{ status: string; ended?: number } | null> {
	const startTime = Date.now();

	while (Date.now() - startTime < timeoutMs) {
		if (abortController?.signal.aborted) {
			throw new Error('Aborted');
		}

		const task = getTaskFromState(taskId);
		if (!task) {
			return null;
		}

		if (isTerminalStatus(task.status as TerminalStatus) || task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
			return { status: task.status, ended: task.endedAt };
		}

		await sleep(100);
	}

	return null;
}

function buildMonitorOutput(
	task: {
		id: string;
		type?: string;
		status: string;
		description?: string;
		createdAt?: number;
		startedAt?: number;
		endedAt?: number;
		result?: string;
		error?: string;
		output?: string;
	},
	monitorSessionId?: string,
	initialOutput?: string,
): MonitorOutput {
	const output = initialOutput || task.output || getTaskOutput(task.id);
	const progress = calculateProgress(task.status, task.createdAt, task.startedAt, task.endedAt);
	const duration =
		task.startedAt && task.endedAt ? task.endedAt - task.startedAt : task.startedAt ? Date.now() - task.startedAt : undefined;

	let exitCode: number | null | undefined;
	if (task.status === 'completed') {
		exitCode = 0;
	} else if (task.status === 'failed') {
		exitCode = 1;
	}

	return {
		taskId: task.id,
		status: task.status as MonitorStatus,
		type: task.type || 'task',
		description: task.description || '',
		progress,
		output,
		exitCode,
		error: task.error,
		result: task.result,
		duration,
		monitorSessionId,
	};
}

export const MonitorTool = buildTool({
	name: MONITOR_TOOL_NAME,
	searchHint: 'monitor task execution with streaming output',
	maxResultSizeChars: 100_000,
	shouldDefer: true,
	aliases: MONITOR_TOOL_ALIASES,

	get inputSchema(): InputSchema {
		return inputSchema();
	},

	get outputSchema(): OutputSchema {
		return outputSchema();
	},

	async description(input: Partial<MonitorInput>): Promise<string> {
		return getMonitorToolDescription(input as MonitorInput);
	},

	async prompt(): Promise<string> {
		return getMonitorToolPrompt();
	},

	userFacingName(): string {
		return 'Task Monitor';
	},

	isConcurrencySafe(): boolean {
		return true;
	},

	isEnabled(): boolean {
		return true;
	},

	isReadOnly(): boolean {
		return true;
	},

	toAutoClassifierInput(input: MonitorInput): string {
		return input.taskId;
	},

	async validateInput({ taskId }: MonitorInput, { getAppState }): Promise<{ result: true } | { result: false; message: string; errorCode: number }> {
		if (!taskId) {
			return {
				result: false,
				message: 'Task ID is required',
				errorCode: 1,
			};
		}

		const appState = getAppState();
		const task = appState.tasks?.[taskId];

		if (!task) {
			return {
				result: false,
				message: `No task found with ID: ${taskId}`,
				errorCode: 2,
			};
		}

		return { result: true };
	},

	interruptBehavior(): 'cancel' | 'block' {
		return 'cancel';
	},

	renderToolUseMessage(input: Partial<MonitorInput>): string {
		const { taskId, stream } = input;
		const streamPart = stream ? ' (streaming)' : '';
		return `Monitoring task ${taskId}${streamPart}`;
	},

	async call(
		input: MonitorInput,
		context: {
			abortController?: AbortController;
			getAppState: () => Record<string, unknown>;
			setInProgressToolUseIDs?: (f: (prev: Set<string>) => Set<string>) => void;
		},
		_canUseTool: unknown,
		_parentMessage: unknown,
		onProgress?: ToolCallProgress<{ type: 'monitor'; taskId?: string; status?: string; progress?: number; output?: string }>,
	): Promise<ToolResult<Output>> {
		const { taskId, stream, streamInterval = DEFAULT_STREAM_INTERVAL, includeHistory, progress: reportProgress } = input;

		const task = getTaskFromState(taskId);
		if (!task) {
			throw new Error(`No task found with ID: ${taskId}`);
		}

		const monitorSession = createMonitorSession(taskId);

		let currentTask = task;
		let currentStatus = task.status;
		let currentOutput = includeHistory ? getTaskOutput(taskId) : '';

		if (stream && onProgress) {
			const initialUpdate: MonitorStreamUpdate = {
				type: 'status',
				data: currentStatus,
				timestamp: Date.now(),
			};
			onProgress({
				toolUseID: context.toolUseId || 'monitor',
				data: {
					type: 'monitor',
					taskId,
					status: currentStatus as MonitorStatus,
					progress: 0,
					output: currentOutput,
					streamId: monitorSession.id,
				},
			});
			monitorSession.outputBuffer.push(currentOutput);
		}

		if (isTerminalStatus(currentStatus as TerminalStatus) || currentStatus === 'completed' || currentStatus === 'failed' || currentStatus === 'cancelled') {
			monitorSession.status = 'completed';
			return {
				data: {
					success: true,
					monitor: buildMonitorOutput({ id: taskId, ...task }, monitorSession.id, currentOutput),
				},
			};
		}

		const maxWaitTime = 300000;
		const startTime = Date.now();

		while (Date.now() - startTime < maxWaitTime) {
			if (context.abortController?.signal.aborted) {
				monitorSession.status = 'cancelled';
				return {
					data: {
						success: false,
						monitor: buildMonitorOutput({ id: taskId, ...currentTask }, monitorSession.id, currentOutput),
					},
				};
			}

			await sleep(streamInterval);

			currentTask = getTaskFromState(taskId) || currentTask;
			const newStatus = currentTask.status;

			if (newStatus !== currentStatus) {
				currentStatus = newStatus;
				monitorSession.lastUpdate = Date.now();

				if (reportProgress && onProgress) {
					onProgress({
						toolUseID: context.toolUseId || 'monitor',
						data: {
							type: 'monitor',
							taskId,
							status: currentStatus as MonitorStatus,
							progress: calculateProgress(currentStatus, currentTask.createdAt, currentTask.startedAt, currentTask.endedAt),
							message: `Status changed to ${currentStatus}`,
							streamId: monitorSession.id,
						},
					});
				}
			}

			const newOutput = getTaskOutput(taskId);
			if (newOutput && newOutput !== currentOutput) {
				const outputDiff = newOutput.slice(currentOutput.length);
				currentOutput = newOutput;
				monitorSession.outputBuffer.push(outputDiff);
				monitorSession.lastUpdate = Date.now();

				if (stream && onProgress) {
					onProgress({
						toolUseID: context.toolUseId || 'monitor',
						data: {
							type: 'monitor',
							taskId,
							status: currentStatus as MonitorStatus,
							output: outputDiff,
							streamId: monitorSession.id,
						},
					});
				}
			}

			if (isTerminalStatus(newStatus as TerminalStatus) || newStatus === 'completed' || newStatus === 'failed' || newStatus === 'cancelled') {
				monitorSession.status = newStatus === 'failed' ? 'failed' : 'completed';

				const finalOutput = buildMonitorOutput({ id: taskId, ...currentTask }, monitorSession.id, currentOutput);

				if (onProgress) {
					onProgress({
						toolUseID: context.toolUseId || 'monitor',
						data: {
							type: 'monitor',
							taskId,
							status: finalOutput.status,
							progress: 100,
							message: `Task ${newStatus}`,
							streamId: monitorSession.id,
						},
					});
				}

				return {
					data: {
						success: newStatus !== 'failed' && newStatus !== 'cancelled',
						monitor: finalOutput,
					},
				};
			}
		}

		monitorSession.status = 'failed';
		return {
			data: {
				success: false,
				monitor: buildMonitorOutput({ id: taskId, ...currentTask }, monitorSession.id, currentOutput),
			},
		};
	},

	mapToolResultToToolResultBlockParam(data: Output, toolUseID: string): { type: 'tool_result'; tool_use_id: string; content: string } {
		const { monitor } = data;
		const parts: string[] = [];

		parts.push(`<task_id>${monitor.taskId}</task_id>`);
		parts.push(`<status>${monitor.status}</status>`);
		parts.push(`<type>${monitor.type}</type>`);
		parts.push(`<progress>${monitor.progress}%</progress>`);

		if (monitor.description) {
			parts.push(`<description>${monitor.description}</description>`);
		}

		if (monitor.exitCode !== undefined && monitor.exitCode !== null) {
			parts.push(`<exit_code>${monitor.exitCode}</exit_code>`);
		}

		if (monitor.duration !== undefined) {
			parts.push(`<duration>${monitor.duration}ms</duration>`);
		}

		if (monitor.output?.trim()) {
			parts.push(`<output>\n${monitor.output.trimEnd()}\n</output>`);
		}

		if (monitor.error) {
			parts.push(`<error>${monitor.error}</error>`);
		}

		if (monitor.result) {
			parts.push(`<result>${monitor.result}</result>`);
		}

		if (monitor.monitorSessionId) {
			parts.push(`<session_id>${monitor.monitorSessionId}</session_id>`);
		}

		return {
			tool_use_id: toolUseID,
			type: 'tool_result',
			content: parts.join('\n\n'),
		};
	},

	renderToolUseProgressMessage(
		progressMessages: Array<{ data: { type: string; taskId?: string; status?: string; progress?: number; output?: string; streamId?: string } }>,
		_options: unknown,
	): string {
		const latestProgress = progressMessages[progressMessages.length - 1]?.data;
		if (!latestProgress || latestProgress.type !== 'monitor') {
			return '';
		}

		const { taskId, status, progress } = latestProgress;
		if (!taskId) return '';

		const statusPart = status ? ` [${status}]` : '';
		const progressPart = progress !== undefined ? ` ${progress}%` : '';
		return `Monitoring${statusPart}${progressPart}`;
	},

	async checkPermissions(): Promise<{ behavior: 'allow' }> {
		return { behavior: 'allow' };
	},
} satisfies ToolDef<InputSchema, Output>);

export function getMonitorSession(sessionId: string): MonitorSession | undefined {
	return activeSessions.get(sessionId);
}

export function cancelMonitorSession(sessionId: string): boolean {
	const session = activeSessions.get(sessionId);
	if (session) {
		session.status = 'cancelled';
		return true;
	}
	return false;
}

export function listActiveMonitorSessions(): MonitorSession[] {
	return Array.from(activeSessions.values()).filter(s => s.status === 'active');
}

export default MonitorTool;
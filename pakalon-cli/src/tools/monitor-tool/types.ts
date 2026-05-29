import { z } from 'zod';

export interface MonitorProgress {
	type: 'monitor';
	taskId?: string;
	status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
	progress?: number;
	message?: string;
	output?: string;
	streamId?: string;
}

export interface MonitoredTask {
	id: string;
	type: string;
	status: string;
	description?: string;
	createdAt?: number;
	startedAt?: number;
	endedAt?: number;
	result?: string;
	error?: string;
	output?: string;
	progress?: number;
}

export interface MonitorSession {
	id: string;
	taskId: string;
	startTime: number;
	lastUpdate: number;
	status: 'active' | 'completed' | 'failed' | 'cancelled';
	outputBuffer: string[];
	progress: number;
}

export const MonitorStatusSchema = () =>
	z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']);

export type MonitorStatus = z.infer<ReturnType<typeof MonitorStatusSchema>>;

export const MonitorInputSchema = () =>
	z.strictObject({
		taskId: z.string().describe('The task ID to monitor'),
		stream: z.boolean().optional().default(false).describe('Enable output streaming'),
		streamInterval: z.number().min(100).max(60000).optional().default(500).describe('Stream update interval in ms'),
		includeHistory: z.boolean().optional().default(false).describe('Include historical output'),
		progress: z.boolean().optional().default(true).describe('Report progress updates'),
	});

export type MonitorInput = z.infer<ReturnType<typeof MonitorInputSchema>>;

export interface MonitorOutput {
	taskId: string;
	status: MonitorStatus;
	type: string;
	description: string;
	progress: number;
	output: string;
	exitCode?: number | null;
	error?: string;
	result?: string;
	duration?: number;
	monitorSessionId?: string;
}

export interface MonitorStreamUpdate {
	type: 'output' | 'progress' | 'status' | 'error' | 'complete';
	data: string | number | MonitorStatus;
	timestamp: number;
}

export interface MonitorToolResult {
	success: boolean;
	monitor: MonitorOutput;
	updates?: MonitorStreamUpdate[];
}
export const MONITOR_TOOL_NAME = 'Monitor';
export const MONITOR_TOOL_ALIASES = ['TaskMonitor', 'WatchTask', 'MonitorTask'];
export const MONITOR_SESSION_PREFIX = 'monitor-';

export const DEFAULT_STREAM_INTERVAL = 500;
export const MIN_STREAM_INTERVAL = 100;
export const MAX_STREAM_INTERVAL = 60000;

export const MAX_OUTPUT_BUFFER_SIZE = 1000;
export const MAX_OUTPUT_CHUNK_SIZE = 50000;

export const PROGRESS_STATES = {
	PENDING: 'pending',
	RUNNING: 'running',
	COMPLETED: 'completed',
	FAILED: 'failed',
	CANCELLED: 'cancelled',
} as const;

export const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const;

export type TerminalStatus = typeof TERMINAL_STATUSES[number];

export function isTerminalStatus(status: string): status is TerminalStatus {
	return TERMINAL_STATUSES.includes(status as TerminalStatus);
}
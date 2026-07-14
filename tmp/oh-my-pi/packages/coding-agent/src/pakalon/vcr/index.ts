/**
 * VCR (Session Replay) module for Pakalon.
 * Allows replaying past session recordings to understand what happened,
 * debug issues, or review the conversation flow.
 *
 * This module provides:
 * - Recording session interactions (messages, tool calls, results)
 * - Replaying recorded sessions with timing
 * - Exporting recordings to various formats
 * - Analyzing recorded sessions for patterns
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export type ReplayEventType = "message" | "tool_call" | "tool_result" | "system" | "error" | "thinking" | "compaction";

export interface ReplayEvent {
	id: string;
	type: ReplayEventType;
	timestamp: number;
	data: {
		role?: "user" | "assistant" | "system";
		content?: string;
		toolName?: string;
		toolCallId?: string;
		args?: Record<string, unknown>;
		result?: string;
		error?: string;
		model?: string;
		tokens?: { input: number; output: number };
		duration?: number;
		[key: string]: unknown;
	};
}

export interface ReplayRecording {
	id: string;
	sessionId: string;
	projectDir: string;
	startTime: number;
	endTime?: number;
	events: ReplayEvent[];
	metadata: {
		model?: string;
		totalTokens?: number;
		totalToolCalls?: number;
		totalDuration?: number;
		eventCount: number;
	};
}

export interface ReplayOptions {
	/** Playback speed multiplier (1 = real-time, 2 = 2x faster) */
	speed?: number;
	/** Show timestamps */
	showTimestamps?: boolean;
	/** Show tool call details */
	showToolDetails?: boolean;
	/** Callback for each event during replay */
	onEvent?: (event: ReplayEvent, index: number) => void;
	/** Callback when replay completes */
	onComplete?: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Recording
// ═══════════════════════════════════════════════════════════════════════════════

const RECORDINGS_DIR = ".pakalon/recordings";

function getRecordingsDir(projectDir: string): string {
	const dir = path.join(projectDir, RECORDINGS_DIR);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function generateRecordingId(): string {
	return `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Start a new recording session.
 */
export function startRecording(projectDir: string, sessionId: string): ReplayRecording {
	const recording: ReplayRecording = {
		id: generateRecordingId(),
		sessionId,
		projectDir,
		startTime: Date.now(),
		events: [],
		metadata: {
			eventCount: 0,
		},
	};

	logger.debug("VCR recording started", { recordingId: recording.id, sessionId });
	return recording;
}

/**
 * Add an event to a recording.
 */
export function addEvent(recording: ReplayRecording, type: ReplayEventType, data: ReplayEvent["data"]): ReplayEvent {
	const event: ReplayEvent = {
		id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
		type,
		timestamp: Date.now(),
		data,
	};

	recording.events.push(event);
	recording.metadata.eventCount = recording.events.length;

	// Update aggregate metadata
	if (data.tokens) {
		recording.metadata.totalTokens = (recording.metadata.totalTokens ?? 0) + data.tokens.input + data.tokens.output;
	}
	if (type === "tool_call") {
		recording.metadata.totalToolCalls = (recording.metadata.totalToolCalls ?? 0) + 1;
	}

	return event;
}

/**
 * Stop and save a recording.
 */
export function stopRecording(recording: ReplayRecording): string {
	recording.endTime = Date.now();
	recording.metadata.totalDuration = recording.endTime - recording.startTime;

	const dir = getRecordingsDir(recording.projectDir);
	const filePath = path.join(dir, `${recording.id}.json`);

	fs.writeFileSync(filePath, JSON.stringify(recording, null, 2));
	logger.debug("VCR recording saved", { recordingId: recording.id, events: recording.events.length });

	return filePath;
}

/**
 * List all recordings for a project.
 */
export function listRecordings(projectDir: string): ReplayRecording[] {
	const dir = getRecordingsDir(projectDir);

	try {
		const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
		return files
			.map(f => {
				try {
					const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
					return data as ReplayRecording;
				} catch {
					return null;
				}
			})
			.filter((r): r is ReplayRecording => r !== null)
			.sort((a, b) => b.startTime - a.startTime);
	} catch {
		return [];
	}
}

/**
 * Load a recording by ID.
 */
export function loadRecording(projectDir: string, recordingId: string): ReplayRecording | null {
	const dir = getRecordingsDir(projectDir);
	const filePath = path.join(dir, `${recordingId}.json`);

	try {
		const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
		return data as ReplayRecording;
	} catch {
		return null;
	}
}

/**
 * Delete a recording.
 */
export function deleteRecording(projectDir: string, recordingId: string): boolean {
	const dir = getRecordingsDir(projectDir);
	const filePath = path.join(dir, `${recordingId}.json`);

	try {
		fs.unlinkSync(filePath);
		return true;
	} catch {
		return false;
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Replay
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Replay a recording with timing.
 * Returns a generator that yields events with appropriate delays.
 */
export async function* replayRecording(
	recording: ReplayRecording,
	options: ReplayOptions = {},
): AsyncGenerator<ReplayEvent, void, unknown> {
	const speed = options.speed ?? 1;
	let lastTimestamp = recording.startTime;

	for (const event of recording.events) {
		// Calculate delay based on real timing
		const delay = (event.timestamp - lastTimestamp) / speed;
		if (delay > 0) {
			await Bun.sleep(Math.min(delay, 5000)); // Cap at 5 seconds
		}

		lastTimestamp = event.timestamp;
		yield event;
		options.onEvent?.(event, recording.events.indexOf(event));
	}

	options.onComplete?.();
}

/**
 * Replay a recording and format output as text.
 */
export function formatReplayOutput(recording: ReplayRecording, options: ReplayOptions = {}): string {
	const lines: string[] = [];

	lines.push("═══ Session Replay ═══");
	lines.push(`Session: ${recording.sessionId}`);
	lines.push(`Duration: ${formatDuration(recording.metadata.totalDuration ?? 0)}`);
	lines.push(`Events: ${recording.metadata.eventCount}`);
	if (recording.metadata.model) lines.push(`Model: ${recording.metadata.model}`);
	if (recording.metadata.totalTokens) lines.push(`Tokens: ${recording.metadata.totalTokens.toLocaleString()}`);
	if (recording.metadata.totalToolCalls) lines.push(`Tool calls: ${recording.metadata.totalToolCalls}`);
	lines.push("═══════════════════════");
	lines.push("");

	for (const event of recording.events) {
		const time = options.showTimestamps ? `[${new Date(event.timestamp).toLocaleTimeString()}] ` : "";

		switch (event.type) {
			case "message":
				if (event.data.role === "user") {
					lines.push(`${time}👤 User: ${event.data.content?.slice(0, 200) ?? ""}`);
				} else if (event.data.role === "assistant") {
					lines.push(`${time}🤖 Assistant: ${event.data.content?.slice(0, 200) ?? ""}`);
				}
				break;

			case "tool_call":
				if (options.showToolDetails) {
					lines.push(`${time}🔧 Tool Call: ${event.data.toolName ?? "unknown"}`);
					if (event.data.args) {
						lines.push(`   Args: ${JSON.stringify(event.data.args).slice(0, 200)}`);
					}
				} else {
					lines.push(`${time}🔧 ${event.data.toolName ?? "tool"}()`);
				}
				break;

			case "tool_result":
				if (options.showToolDetails && event.data.result) {
					lines.push(`${time}📦 Result: ${event.data.result.slice(0, 150)}`);
				}
				break;

			case "error":
				lines.push(`${time}❌ Error: ${event.data.error ?? event.data.content ?? "unknown"}`);
				break;

			case "thinking":
				if (event.data.content) {
					lines.push(`${time}💭 ${event.data.content.slice(0, 100)}`);
				}
				break;
		}
	}

	return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Analysis
// ═══════════════════════════════════════════════════════════════════════════════

export interface ReplayAnalysis {
	totalMessages: number;
	totalToolCalls: number;
	totalTokens: number;
	totalDuration: number;
	avgResponseLength: number;
	toolUsage: Record<string, number>;
	mostUsedTools: Array<{ name: string; count: number }>;
	errorCount: number;
	errorRate: number;
}

/**
 * Analyze a recording for patterns and statistics.
 */
export function analyzeRecording(recording: ReplayRecording): ReplayAnalysis {
	const toolUsage: Record<string, number> = {};
	let totalMessages = 0;
	let totalToolCalls = 0;
	let totalTokens = 0;
	let totalContentLength = 0;
	let errorCount = 0;

	for (const event of recording.events) {
		switch (event.type) {
			case "message":
				totalMessages++;
				totalContentLength += event.data.content?.length ?? 0;
				if (event.data.tokens) {
					totalTokens += event.data.tokens.input + event.data.tokens.output;
				}
				break;

			case "tool_call":
				totalToolCalls++;
				if (event.data.toolName) {
					toolUsage[event.data.toolName] = (toolUsage[event.data.toolName] ?? 0) + 1;
				}
				break;

			case "error":
				errorCount++;
				break;
		}
	}

	const mostUsedTools = Object.entries(toolUsage)
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 10);

	return {
		totalMessages,
		totalToolCalls,
		totalTokens: (totalTokens || recording.metadata.totalTokens) ?? 0,
		totalDuration: recording.metadata.totalDuration ?? 0,
		avgResponseLength: totalMessages > 0 ? Math.round(totalContentLength / totalMessages) : 0,
		toolUsage,
		mostUsedTools,
		errorCount,
		errorRate: totalMessages > 0 ? errorCount / totalMessages : 0,
	};
}

/**
 * Format analysis output.
 */
export function formatAnalysis(analysis: ReplayAnalysis): string {
	const lines = [
		"═══ Replay Analysis ═══",
		"",
		`Messages: ${analysis.totalMessages}`,
		`Tool calls: ${analysis.totalToolCalls}`,
		`Tokens: ${analysis.totalTokens.toLocaleString()}`,
		`Duration: ${formatDuration(analysis.totalDuration)}`,
		`Avg response length: ${analysis.avgResponseLength.toLocaleString()} chars`,
		`Errors: ${analysis.errorCount} (${(analysis.errorRate * 100).toFixed(1)}%)`,
		"",
		"Most Used Tools:",
	];

	for (const tool of analysis.mostUsedTools) {
		lines.push(`  ${tool.name}: ${tool.count}`);
	}

	return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	return `${minutes}m ${remainingSeconds}s`;
}

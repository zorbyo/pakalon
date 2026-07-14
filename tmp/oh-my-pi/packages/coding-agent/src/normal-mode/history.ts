/**
 * History management for Pakalon normal mode.
 * Tracks prompts, code changes, and session history with timestamps.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export type HistoryEntryType = "prompt" | "code_change" | "command" | "error" | "info";

export interface HistoryEntry {
	id: string;
	type: HistoryEntryType;
	content: string;
	timestamp: string;
	sessionId?: string;
	modelId?: string;
	tokensUsed?: number;
	filesModified?: string[];
	linesAdded?: number;
	linesRemoved?: number;
	duration?: number;
	metadata?: Record<string, unknown>;
}

export interface CodeChange {
	filePath: string;
	additions: number;
	deletions: number;
	timestamp: string;
}

export interface HistorySummary {
	totalEntries: number;
	totalPrompts: number;
	totalCodeChanges: number;
	totalTokens: number;
	totalFilesModified: number;
	entriesByType: Record<HistoryEntryType, number>;
	recentChanges: CodeChange[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Storage
// ═══════════════════════════════════════════════════════════════════════════════

function getHistoryDir(cwd: string): string {
	return path.join(cwd, ".pakalon", "history");
}

function getHistoryFilePath(cwd: string, date: string): string {
	return path.join(getHistoryDir(cwd), `${date}.jsonl`);
}

function ensureHistoryDir(cwd: string): void {
	const dir = getHistoryDir(cwd);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

function generateEntryId(): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).slice(2, 6);
	return `hist_${timestamp}_${random}`;
}

function getCurrentDate(): string {
	return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// ═══════════════════════════════════════════════════════════════════════════════
// Core operations
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Add a history entry.
 */
export function addHistoryEntry(
	cwd: string,
	type: HistoryEntryType,
	content: string,
	options: {
		sessionId?: string;
		modelId?: string;
		tokensUsed?: number;
		filesModified?: string[];
		linesAdded?: number;
		linesRemoved?: number;
		duration?: number;
		metadata?: Record<string, unknown>;
	} = {},
): HistoryEntry {
	ensureHistoryDir(cwd);

	const entry: HistoryEntry = {
		id: generateEntryId(),
		type,
		content,
		timestamp: new Date().toISOString(),
		...options,
	};

	const filePath = getHistoryFilePath(cwd, getCurrentDate());
	const line = `${JSON.stringify(entry)}\n`;
	fs.appendFileSync(filePath, line);

	logger.debug("History entry added", { id: entry.id, type });
	return entry;
}

/**
 * Get history entries for a specific date.
 */
export function getHistoryByDate(cwd: string, date: string): HistoryEntry[] {
	try {
		const filePath = getHistoryFilePath(cwd, date);
		const raw = fs.readFileSync(filePath, "utf-8");
		const lines = raw.trim().split("\n").filter(Boolean);
		return lines.map(line => JSON.parse(line) as HistoryEntry);
	} catch {
		return [];
	}
}

/**
 * Get history entries for today.
 */
export function getTodayHistory(cwd: string): HistoryEntry[] {
	return getHistoryByDate(cwd, getCurrentDate());
}

/**
 * Get history entries for the last N days.
 */
export function getRecentHistory(cwd: string, days: number = 7): HistoryEntry[] {
	const entries: HistoryEntry[] = [];
	const today = new Date();

	for (let i = 0; i < days; i++) {
		const date = new Date(today);
		date.setDate(date.getDate() - i);
		const dateStr = date.toISOString().slice(0, 10);
		entries.push(...getHistoryByDate(cwd, dateStr));
	}

	// Sort by timestamp descending
	entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
	return entries;
}

/**
 * Search history entries.
 */
export function searchHistory(cwd: string, query: string, days: number = 30): HistoryEntry[] {
	const entries = getRecentHistory(cwd, days);
	const lower = query.toLowerCase();
	return entries.filter(e => e.content.toLowerCase().includes(lower));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Code change tracking
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Log a code change.
 */
export function logCodeChange(
	cwd: string,
	filePath: string,
	additions: number,
	deletions: number,
	sessionId?: string,
): HistoryEntry {
	return addHistoryEntry(cwd, "code_change", `Modified ${filePath}`, {
		sessionId,
		filesModified: [filePath],
		linesAdded: additions,
		linesRemoved: deletions,
	});
}

/**
 * Get all code changes.
 */
export function getCodeChanges(cwd: string, days: number = 30): CodeChange[] {
	const entries = getRecentHistory(cwd, days);
	return entries
		.filter(e => e.type === "code_change" && e.filesModified)
		.flatMap(e =>
			(e.filesModified ?? []).map(file => ({
				filePath: file,
				additions: e.linesAdded ?? 0,
				deletions: e.linesRemoved ?? 0,
				timestamp: e.timestamp,
			})),
		);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get history summary.
 */
export function getHistorySummary(cwd: string, days: number = 7): HistorySummary {
	const entries = getRecentHistory(cwd, days);

	const entriesByType: Record<HistoryEntryType, number> = {
		prompt: 0,
		code_change: 0,
		command: 0,
		error: 0,
		info: 0,
	};

	let totalTokens = 0;
	let totalFilesModified = 0;
	const filesModifiedSet = new Set<string>();

	for (const entry of entries) {
		entriesByType[entry.type]++;

		if (entry.tokensUsed) {
			totalTokens += entry.tokensUsed;
		}

		if (entry.filesModified) {
			for (const file of entry.filesModified) {
				filesModifiedSet.add(file);
			}
		}
	}

	totalFilesModified = filesModifiedSet.size;

	const recentChanges = getCodeChanges(cwd, days);

	return {
		totalEntries: entries.length,
		totalPrompts: entriesByType.prompt,
		totalCodeChanges: entriesByType.code_change,
		totalTokens,
		totalFilesModified,
		entriesByType,
		recentChanges: recentChanges.slice(0, 10),
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// Formatting
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Format history for display.
 */
export function formatHistory(cwd: string, days: number = 7): string {
	const entries = getRecentHistory(cwd, days);
	if (entries.length === 0) {
		return "No history entries found.";
	}

	const lines = [`History (last ${days} days):`, "═══════════════════════════════════════"];

	for (const entry of entries.slice(0, 50)) {
		const time = new Date(entry.timestamp).toLocaleTimeString();
		const icon =
			entry.type === "prompt"
				? "💬"
				: entry.type === "code_change"
					? "📝"
					: entry.type === "command"
						? "⚡"
						: entry.type === "error"
							? "❌"
							: "ℹ️";

		lines.push(`${icon} [${time}] ${entry.content.slice(0, 80)}`);

		if (entry.filesModified && entry.filesModified.length > 0) {
			lines.push(`   Files: ${entry.filesModified.join(", ")}`);
		}
	}

	if (entries.length > 50) {
		lines.push(`... and ${entries.length - 50} more entries`);
	}

	return lines.join("\n");
}

/**
 * Format history summary for display.
 */
export function formatHistorySummary(cwd: string, days: number = 7): string {
	const summary = getHistorySummary(cwd, days);

	const lines = [
		"History Summary",
		"═══════════════════════════════════════",
		`Period: Last ${days} days`,
		`Total Entries: ${summary.totalEntries}`,
		`Prompts: ${summary.totalPrompts}`,
		`Code Changes: ${summary.totalCodeChanges}`,
		`Tokens Used: ${summary.totalTokens.toLocaleString()}`,
		`Files Modified: ${summary.totalFilesModified}`,
		"",
		"Breakdown:",
	];

	for (const [type, count] of Object.entries(summary.entriesByType)) {
		if (count > 0) {
			lines.push(`  ${type}: ${count}`);
		}
	}

	if (summary.recentChanges.length > 0) {
		lines.push("");
		lines.push("Recent Changes:");
		for (const change of summary.recentChanges) {
			const time = new Date(change.timestamp).toLocaleDateString();
			lines.push(`  ${time}: ${change.filePath} (+${change.additions} -${change.deletions})`);
		}
	}

	return lines.join("\n");
}

/**
 * Format prompt history for display.
 */
export function formatPromptHistory(cwd: string, limit: number = 20): string {
	const entries = getRecentHistory(cwd, 30)
		.filter(e => e.type === "prompt")
		.slice(0, limit);

	if (entries.length === 0) {
		return "No prompt history found.";
	}

	const lines = ["Prompt History:", "═══════════════════════════════════════"];

	for (const entry of entries) {
		const time = new Date(entry.timestamp).toLocaleString();
		const model = entry.modelId ? ` [${entry.modelId}]` : "";
		const tokens = entry.tokensUsed ? ` (${entry.tokensUsed.toLocaleString()} tokens)` : "";
		lines.push(`[${time}]${model}${tokens} ${entry.content.slice(0, 100)}`);
	}

	return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Enhanced History (CLI-req.md §History)
// ═══════════════════════════════════════════════════════════════════════════════

export interface FileChangeDetail {
	filePath: string;
	additions: number;
	deletions: number;
	timestamp: string;
	prompt?: string;
	modelId?: string;
	sessionId?: string;
}

/**
 * Get detailed file change history with line counts per prompt.
 * Shows which prompts caused which file changes with exact line counts.
 */
export function getFileChangeHistory(cwd: string, days: number = 30): FileChangeDetail[] {
	const entries = getRecentHistory(cwd, days);
	const changes: FileChangeDetail[] = [];

	for (const entry of entries) {
		if (entry.type === "code_change" && entry.filesModified) {
			for (const file of entry.filesModified) {
				changes.push({
					filePath: file,
					additions: entry.linesAdded ?? 0,
					deletions: entry.linesRemoved ?? 0,
					timestamp: entry.timestamp,
					prompt: entry.content,
					modelId: entry.modelId,
					sessionId: entry.sessionId,
				});
			}
		}
	}

	return changes.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/**
 * Format file change history for display.
 * Shows timestamps, line changes, and associated prompts.
 */
export function formatFileChangeHistory(cwd: string, days: number = 30): string {
	const changes = getFileChangeHistory(cwd, days);
	if (changes.length === 0) {
		return "No file changes found in history.";
	}

	const lines = ["File Change History", "═══════════════════════════════════════", ""];

	// Group by date
	const byDate = new Map<string, FileChangeDetail[]>();
	for (const change of changes) {
		const date = new Date(change.timestamp).toISOString().slice(0, 10);
		const list = byDate.get(date) ?? [];
		list.push(change);
		byDate.set(date, list);
	}

	for (const [date, dayChanges] of byDate) {
		lines.push(`📅 ${date}`);
		for (const change of dayChanges) {
			const time = new Date(change.timestamp).toLocaleTimeString();
			const sign = change.additions > 0 ? `+${change.additions}` : "";
			const del = change.deletions > 0 ? ` -${change.deletions}` : "";
			lines.push(`  ${time} ${change.filePath} (${sign}${del})`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

/**
 * Format the full history view combining prompts and file changes.
 * Shows the prompts that were sent, the number of lines changed, and timestamps.
 */
export function formatFullHistory(cwd: string, days: number = 7): string {
	const entries = getRecentHistory(cwd, days);
	if (entries.length === 0) {
		return "No history entries found.";
	}

	const summary = getHistorySummary(cwd, days);
	const lines = [
		"Pakalon History",
		"═══════════════════════════════════════",
		`Period: Last ${days} days`,
		`Total entries: ${summary.totalEntries}`,
		`Prompts: ${summary.totalPrompts}`,
		`Code changes: ${summary.totalCodeChanges}`,
		`Tokens used: ${summary.totalTokens.toLocaleString()}`,
		`Files modified: ${summary.totalFilesModified}`,
		"",
		"─── Timeline ───",
		"",
	];

	// Show last 30 entries in chronological order
	const recent = entries.slice(0, 30);
	for (const entry of recent.reverse()) {
		const time = new Date(entry.timestamp).toLocaleString();
		const model = entry.modelId ? ` [${entry.modelId}]` : "";

		if (entry.type === "prompt") {
			const tokens = entry.tokensUsed ? ` (${entry.tokensUsed.toLocaleString()} tokens)` : "";
			lines.push(`💬 [${time}]${model}${tokens}`);
			lines.push(`   ${entry.content.slice(0, 120)}`);
		} else if (entry.type === "code_change") {
			const files = entry.filesModified?.join(", ") ?? "unknown";
			const added = entry.linesAdded ?? 0;
			const removed = entry.linesRemoved ?? 0;
			lines.push(`📝 [${time}] ${files} (+${added} -${removed})`);
		} else if (entry.type === "command") {
			lines.push(`⚡ [${time}] ${entry.content.slice(0, 100)}`);
		} else if (entry.type === "error") {
			lines.push(`❌ [${time}] ${entry.content.slice(0, 100)}`);
		}
	}

	return lines.join("\n");
}

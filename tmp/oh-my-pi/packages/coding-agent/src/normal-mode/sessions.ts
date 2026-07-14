/**
 * Session management for Pakalon normal mode.
 * Supports session persistence, resume, and multi-session.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export type SessionStatus = "active" | "paused" | "completed" | "archived";

export interface Message {
	id: string;
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: string;
	tokensUsed?: number;
	modelId?: string;
}

export interface Session {
	id: string;
	name: string;
	status: SessionStatus;
	messages: Message[];
	createdAt: string;
	updatedAt: string;
	lastResumedAt?: string;
	totalTokens: number;
	totalCost: number;
	modelId: string;
	tags: string[];
}

export interface SessionSummary {
	id: string;
	name: string;
	status: SessionStatus;
	messageCount: number;
	createdAt: string;
	updatedAt: string;
	totalTokens: number;
	totalCost: number;
	modelId: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Storage
// ═══════════════════════════════════════════════════════════════════════════════

function getSessionsDir(cwd: string): string {
	return path.join(cwd, ".pakalon", "sessions");
}

function getSessionFilePath(cwd: string, sessionId: string): string {
	return path.join(getSessionsDir(cwd), `${sessionId}.json`);
}

function ensureSessionsDir(cwd: string): void {
	const dir = getSessionsDir(cwd);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

function generateSessionId(): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).slice(2, 8);
	return `ses_${timestamp}_${random}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Core operations
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a new session.
 */
export function createSession(cwd: string, name: string, modelId: string = "auto"): Session {
	ensureSessionsDir(cwd);

	const session: Session = {
		id: generateSessionId(),
		name,
		status: "active",
		messages: [],
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		totalTokens: 0,
		totalCost: 0,
		modelId,
		tags: [],
	};

	const filePath = getSessionFilePath(cwd, session.id);
	fs.writeFileSync(filePath, JSON.stringify(session, null, 2));

	logger.info("Session created", { id: session.id, name, modelId });
	return session;
}

/**
 * Get a session by ID.
 */
export function getSession(cwd: string, sessionId: string): Session | null {
	try {
		const filePath = getSessionFilePath(cwd, sessionId);
		const raw = fs.readFileSync(filePath, "utf-8");
		return JSON.parse(raw) as Session;
	} catch {
		return null;
	}
}

/**
 * Save a session.
 */
export function saveSession(cwd: string, session: Session): void {
	ensureSessionsDir(cwd);
	session.updatedAt = new Date().toISOString();

	const filePath = getSessionFilePath(cwd, session.id);
	fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
}

/**
 * Delete a session.
 */
export function deleteSession(cwd: string, sessionId: string): boolean {
	try {
		const filePath = getSessionFilePath(cwd, sessionId);
		fs.unlinkSync(filePath);
		logger.info("Session deleted", { id: sessionId });
		return true;
	} catch {
		return false;
	}
}

/**
 * List all sessions.
 */
export function listSessions(cwd: string, status?: SessionStatus): SessionSummary[] {
	ensureSessionsDir(cwd);
	const dir = getSessionsDir(cwd);
	const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));

	const sessions: SessionSummary[] = [];
	for (const file of files) {
		try {
			const raw = fs.readFileSync(path.join(dir, file), "utf-8");
			const session = JSON.parse(raw) as Session;
			if (!status || session.status === status) {
				sessions.push({
					id: session.id,
					name: session.name,
					status: session.status,
					messageCount: session.messages.length,
					createdAt: session.createdAt,
					updatedAt: session.updatedAt,
					totalTokens: session.totalTokens,
					totalCost: session.totalCost,
					modelId: session.modelId,
				});
			}
		} catch {
			// Skip invalid files
		}
	}

	// Sort by updatedAt descending
	sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
	return sessions;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Resume functionality
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resume a session.
 */
export function resumeSession(cwd: string, sessionId: string): Session | null {
	const session = getSession(cwd, sessionId);
	if (!session) return null;

	session.status = "active";
	session.lastResumedAt = new Date().toISOString();
	saveSession(cwd, session);

	logger.info("Session resumed", { id: sessionId, name: session.name });
	return session;
}

/**
 * Pause a session.
 */
export function pauseSession(cwd: string, sessionId: string): boolean {
	const session = getSession(cwd, sessionId);
	if (!session) return false;

	session.status = "paused";
	saveSession(cwd, session);

	logger.info("Session paused", { id: sessionId });
	return true;
}

/**
 * Complete a session.
 */
export function completeSession(cwd: string, sessionId: string): boolean {
	const session = getSession(cwd, sessionId);
	if (!session) return false;

	session.status = "completed";
	saveSession(cwd, session);

	logger.info("Session completed", { id: sessionId });
	return true;
}

/**
 * Archive a session.
 */
export function archiveSession(cwd: string, sessionId: string): boolean {
	const session = getSession(cwd, sessionId);
	if (!session) return false;

	session.status = "archived";
	saveSession(cwd, session);

	logger.info("Session archived", { id: sessionId });
	return true;
}

/**
 * Get the most recent active session.
 */
export function getActiveSession(cwd: string): Session | null {
	const sessions = listSessions(cwd, "active");
	if (sessions.length === 0) return null;

	// Sort by lastResumedAt or updatedAt
	const sorted = sessions.sort((a, b) => {
		const aTime = a.updatedAt;
		const bTime = b.updatedAt;
		return new Date(bTime).getTime() - new Date(aTime).getTime();
	});

	return getSession(cwd, sorted[0]!.id);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Message management
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Add a message to a session.
 */
export function addMessage(
	cwd: string,
	sessionId: string,
	role: Message["role"],
	content: string,
	options: { tokensUsed?: number; modelId?: string } = {},
): Message | null {
	const session = getSession(cwd, sessionId);
	if (!session) return null;

	const message: Message = {
		id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
		role,
		content,
		timestamp: new Date().toISOString(),
		tokensUsed: options.tokensUsed,
		modelId: options.modelId,
	};

	session.messages.push(message);

	// Update totals
	if (options.tokensUsed) {
		session.totalTokens += options.tokensUsed;
	}

	saveSession(cwd, session);
	return message;
}

/**
 * Get messages from a session.
 */
export function getMessages(cwd: string, sessionId: string, limit?: number): Message[] {
	const session = getSession(cwd, sessionId);
	if (!session) return [];

	const messages = session.messages;
	if (limit && limit > 0) {
		return messages.slice(-limit);
	}
	return messages;
}

/**
 * Search messages in a session.
 */
export function searchMessages(cwd: string, sessionId: string, query: string): Message[] {
	const session = getSession(cwd, sessionId);
	if (!session) return [];

	const lower = query.toLowerCase();
	return session.messages.filter(m => m.content.toLowerCase().includes(lower));
}

/**
 * Clear messages from a session.
 */
export function clearMessages(cwd: string, sessionId: string): boolean {
	const session = getSession(cwd, sessionId);
	if (!session) return false;

	session.messages = [];
	session.totalTokens = 0;
	session.totalCost = 0;
	saveSession(cwd, session);

	logger.info("Session messages cleared", { id: sessionId });
	return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tags
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Add tags to a session.
 */
export function addTags(cwd: string, sessionId: string, tags: string[]): boolean {
	const session = getSession(cwd, sessionId);
	if (!session) return false;

	for (const tag of tags) {
		if (!session.tags.includes(tag)) {
			session.tags.push(tag);
		}
	}

	saveSession(cwd, session);
	return true;
}

/**
 * Remove tags from a session.
 */
export function removeTags(cwd: string, sessionId: string, tags: string[]): boolean {
	const session = getSession(cwd, sessionId);
	if (!session) return false;

	session.tags = session.tags.filter(t => !tags.includes(t));
	saveSession(cwd, session);
	return true;
}

/**
 * Filter sessions by tag.
 */
export function filterByTag(cwd: string, tag: string): SessionSummary[] {
	return listSessions(cwd).filter(s => s.id && getSession(cwd, s.id)?.tags.includes(tag));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Formatting
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Format session list for display.
 */
export function formatSessionList(cwd: string, status?: SessionStatus): string {
	const sessions = listSessions(cwd, status);
	if (sessions.length === 0) {
		return "No sessions found.";
	}

	const lines = ["Sessions:", "═══════════════════════════════════════"];

	for (const session of sessions) {
		const icon =
			session.status === "active"
				? "●"
				: session.status === "paused"
					? "◐"
					: session.status === "completed"
						? "○"
						: "◌";
		lines.push(`${icon} ${session.name} (${session.id})`);
		lines.push(`  Status: ${session.status} | Messages: ${session.messageCount}`);
		lines.push(`  Model: ${session.modelId} | Tokens: ${session.totalTokens.toLocaleString()}`);
		lines.push(`  Created: ${session.createdAt}`);
		lines.push("");
	}

	lines.push("Use /resume <session-id> to resume a session");
	return lines.join("\n");
}

/**
 * Format a single session for display.
 */
export function formatSession(cwd: string, sessionId: string): string {
	const session = getSession(cwd, sessionId);
	if (!session) return "Session not found.";

	const lines = [
		`Session: ${session.name}`,
		"═══════════════════════════════════════",
		`ID: ${session.id}`,
		`Status: ${session.status}`,
		`Model: ${session.modelId}`,
		`Messages: ${session.messages.length}`,
		`Total Tokens: ${session.totalTokens.toLocaleString()}`,
		`Total Cost: $${session.totalCost.toFixed(4)}`,
		`Created: ${session.createdAt}`,
		`Updated: ${session.updatedAt}`,
	];

	if (session.lastResumedAt) {
		lines.push(`Last Resumed: ${session.lastResumedAt}`);
	}

	if (session.tags.length > 0) {
		lines.push(`Tags: ${session.tags.join(", ")}`);
	}

	return lines.join("\n");
}

/**
 * Multi-session manager for Pakalon normal mode.
 * Provides /multi-session command with card layout and blink indicators.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";

// =============================================================================
// Types
// =============================================================================

export interface SessionCard {
	id: string;
	name: string;
	projectDir: string;
	createdAt: number;
	lastActiveAt: number;
	messageCount: number;
	status: "active" | "paused" | "completed" | "archived";
	model?: string;
	phase?: string;
}

export interface MultiSessionState {
	sessions: SessionCard[];
	activeSessionId?: string;
}

// =============================================================================
// Storage
// =============================================================================

function getSessionsDir(projectDir: string): string {
	return path.join(projectDir, ".pakalon", "sessions");
}

function getSessionPath(projectDir: string, sessionId: string): string {
	return path.join(getSessionsDir(projectDir), `${sessionId}.json`);
}

/**
 * Load all sessions for a project directory.
 */
export function loadSessions(projectDir: string): SessionCard[] {
	const dir = getSessionsDir(projectDir);
	if (!fs.existsSync(dir)) return [];

	try {
		const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
		return files.map(f => {
			const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
			return {
				id: data.id || path.basename(f, ".json"),
				name: data.name || `Session ${path.basename(f, ".json").slice(0, 8)}`,
				projectDir: data.projectDir || projectDir,
				createdAt: data.createdAt || Date.now(),
				lastActiveAt: data.lastActiveAt || Date.now(),
				messageCount: data.messageCount || 0,
				status: data.status || "active",
				model: data.model,
				phase: data.phase,
			};
		});
	} catch {
		return [];
	}
}

/**
 * Save a session card.
 */
export function saveSession(projectDir: string, session: SessionCard): void {
	const dir = getSessionsDir(projectDir);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	const filePath = getSessionPath(projectDir, session.id);
	fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
}

/**
 * Update session activity timestamp.
 */
export function touchSession(projectDir: string, sessionId: string): void {
	const sessions = loadSessions(projectDir);
	const session = sessions.find(s => s.id === sessionId);
	if (session) {
		session.lastActiveAt = Date.now();
		session.messageCount++;
		saveSession(projectDir, session);
	}
}

/**
 * Delete a session.
 */
export function deleteSession(projectDir: string, sessionId: string): boolean {
	const filePath = getSessionPath(projectDir, sessionId);
	if (fs.existsSync(filePath)) {
		fs.unlinkSync(filePath);
		return true;
	}
	return false;
}

// =============================================================================
// Rendering
// =============================================================================

/**
 * Render session cards as a formatted string.
 */
export function renderSessionCards(sessions: SessionCard[], activeSessionId?: string): string {
	if (sessions.length === 0) {
		return chalk.dim("No sessions found. Start chatting to create one.");
	}

	const lines: string[] = [];
	lines.push(chalk.bold("Active Sessions:\n"));

	// Sort by last active (most recent first)
	const sorted = [...sessions].sort((a, b) => b.lastActiveAt - a.lastActiveAt);

	for (const session of sorted) {
		const isActive = session.id === activeSessionId;
		const blink = isActive ? chalk.green.bold("●") : chalk.dim("○");
		const name = isActive ? chalk.bold.cyan(session.name) : chalk.white(session.name);
		const age = formatAge(session.lastActiveAt);
		const msgs = chalk.dim(`${session.messageCount} messages`);
		const model = session.model ? chalk.dim(` [${session.model}]`) : "";
		const phase = session.phase ? chalk.yellow(` (${session.phase})`) : "";

		lines.push(`  ${blink} ${name}${model}${phase}`);
		lines.push(
			`    ${chalk.dim("ID:")} ${chalk.dim(session.id.slice(0, 12))}  ${chalk.dim("Last active:")} ${age}  ${msgs}`,
		);
	}

	return lines.join("\n");
}

/**
 * Render a compact session selector for interactive use.
 */
export function renderSessionSelector(sessions: SessionCard[], activeSessionId?: string): string {
	if (sessions.length === 0) {
		return chalk.dim("No sessions. Press Enter to start a new one.");
	}

	const sorted = [...sessions].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
	const lines: string[] = [];

	for (let i = 0; i < sorted.length; i++) {
		const s = sorted[i];
		const num = chalk.dim(`${i + 1}.`);
		const blink = s.id === activeSessionId ? chalk.green("●") : chalk.dim("○");
		const name = s.id === activeSessionId ? chalk.bold.cyan(s.name) : s.name;
		const age = formatAge(s.lastActiveAt);
		lines.push(`  ${num} ${blink} ${name} ${chalk.dim(`(${age})`)}`);
	}

	lines.push("");
	lines.push(chalk.dim("Enter number to switch, or press Enter for new session."));

	return lines.join("\n");
}

// =============================================================================
// Helpers
// =============================================================================

function formatAge(timestamp: number): string {
	const diff = Date.now() - timestamp;
	const minutes = Math.floor(diff / 60000);
	const hours = Math.floor(diff / 3600000);
	const days = Math.floor(diff / 86400000);

	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	if (hours < 24) return `${hours}h ago`;
	return `${days}d ago`;
}

/**
 * Create a new session card.
 */
export function createSessionCard(projectDir: string, name?: string, model?: string): SessionCard {
	const id = crypto.randomUUID();
	const now = Date.now();
	return {
		id,
		name: name || `Session ${id.slice(0, 8)}`,
		projectDir,
		createdAt: now,
		lastActiveAt: now,
		messageCount: 0,
		status: "active",
		model,
	};
}

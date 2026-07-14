/**
 * Session management commands: /session, /new, /resume, /history
 */

import type { CommandEntry } from "@oh-my-pi/pi-utils/cli";
import fs from "fs";
import path from "path";

const SESSIONS_DIR = (cwd: string) => path.join(cwd, ".pakalon-agents", "sessions");
const SESSION_CONFIG = (cwd: string) => path.join(SESSIONS_DIR(cwd), "sessions.json");

export const sessionCommand: CommandEntry = {
	name: "session",
	description: "List or switch between sessions",
	usage: "/session [session-id]",
	async execute(args: string[]) {
		const cwd = process.cwd();

		if (args.length > 0) {
			const sessionId = args[0];
			return switchSession(cwd, sessionId);
		}

		return listSessions(cwd);
	},
};

export const newSessionCommand: CommandEntry = {
	name: "new",
	description: "Create a new session",
	usage: "/new [session-name]",
	async execute(args: string[]) {
		const cwd = process.cwd();
		const sessionName = args.join(" ") || `Session-${Date.now()}`;

		return createSession(cwd, sessionName);
	},
};

export const resumeCommand: CommandEntry = {
	name: "resume",
	description: "Resume a previous session",
	usage: "/resume [session-id]",
	async execute(args: string[]) {
		const cwd = process.cwd();

		if (args.length === 0) {
			return resumeMostRecent(cwd);
		}

		const sessionId = args[0];
		return resumeSession(cwd, sessionId);
	},
};

export const historyCommand: CommandEntry = {
	name: "history",
	description: "Show conversation and code change history",
	usage: "/history",
	async execute(_args: string[]) {
		const cwd = process.cwd();
		return showHistory(cwd);
	},
};

function ensureSessionsDir(cwd: string): string {
	const dir = SESSIONS_DIR(cwd);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function loadSessions(
	cwd: string,
): { id: string; name: string; created: string; lastActive: string; messageCount: number }[] {
	const configPath = SESSION_CONFIG(cwd);
	if (!fs.existsSync(configPath)) {
		return [];
	}
	try {
		const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
		return config.sessions || [];
	} catch {
		return [];
	}
}

function saveSessions(
	cwd: string,
	sessions: { id: string; name: string; created: string; lastActive: string; messageCount: number }[],
): void {
	const _dir = ensureSessionsDir(cwd);
	const configPath = SESSION_CONFIG(cwd);
	fs.writeFileSync(configPath, JSON.stringify({ sessions }, null, 2));
}

function listSessions(cwd: string): { success: boolean; message: string } {
	const sessions = loadSessions(cwd);

	if (sessions.length === 0) {
		return {
			success: true,
			message: "Sessions\n\nNo previous sessions found.\n\nTip: Use /new to create a new session.",
		};
	}

	const list = sessions
		.map(
			(s, i) =>
				`${i + 1}. **${s.name}**\n` +
				`   ID: ${s.id}\n` +
				`   Last active: ${new Date(s.lastActive).toLocaleString()}\n` +
				`   Messages: ${s.messageCount}`,
		)
		.join("\n\n");

	return {
		success: true,
		message:
			`Sessions (${sessions.length})\n\n${list}\n\n` +
			`Tip: Use /session <id> to switch\n` +
			`Tip: Use /resume to resume most recent`,
	};
}

function createSession(cwd: string, name: string): { success: boolean; message: string } {
	const sessions = loadSessions(cwd);
	const newSession = {
		id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		name,
		created: new Date().toISOString(),
		lastActive: new Date().toISOString(),
		messageCount: 0,
	};

	sessions.unshift(newSession);
	saveSessions(cwd, sessions);

	return {
		success: true,
		message:
			`[OK] New session created\n\n` +
			`Name: ${name}\n` +
			`ID: ${newSession.id}\n\n` +
			`Tip: Use /resume to resume this session later.`,
	};
}

function switchSession(cwd: string, sessionId: string): { success: boolean; message: string } {
	const sessions = loadSessions(cwd);
	const session = sessions.find(s => s.id === sessionId);

	if (!session) {
		return {
			success: false,
			message: `Error: Session not found: ${sessionId}\n\nTip: Use /session to list available sessions.`,
		};
	}

	session.lastActive = new Date().toISOString();
	saveSessions(cwd, sessions);

	return {
		success: true,
		message:
			`Switched to session\n\n` +
			`Name: ${session.name}\n` +
			`ID: ${session.id}\n` +
			`Last active: ${new Date(session.lastActive).toLocaleString()}`,
	};
}

function resumeMostRecent(cwd: string): { success: boolean; message: string } {
	const sessions = loadSessions(cwd);

	if (sessions.length === 0) {
		return {
			success: false,
			message: "Error: No sessions to resume.\n\nTip: Use /new to create a new session.",
		};
	}

	const mostRecent = sessions[0]!;
	return resumeSession(cwd, mostRecent.id);
}

function resumeSession(cwd: string, sessionId: string): { success: boolean; message: string } {
	const sessions = loadSessions(cwd);
	const session = sessions.find(s => s.id === sessionId);

	if (!session) {
		return {
			success: false,
			message: `Error: Session not found: ${sessionId}`,
		};
	}

	session.lastActive = new Date().toISOString();
	saveSessions(cwd, sessions);

	const sessionDir = path.join(SESSIONS_DIR(cwd), sessionId);
	const history: { timestamp: string; type: string; content: string }[] = [];
	if (fs.existsSync(path.join(sessionDir, "messages.jsonl"))) {
		const lines = fs.readFileSync(path.join(sessionDir, "messages.jsonl"), "utf-8").split("\n").filter(Boolean);
		for (const line of lines.slice(-10)) {
			try {
				history.push(JSON.parse(line));
			} catch {
				/* skip */
			}
		}
	}

	const recentMessages = history
		.map(m => `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.type}: ${m.content.slice(0, 100)}`)
		.join("\n");

	return {
		success: true,
		message:
			`Resumed session\n\n` +
			`Name: ${session.name}\n` +
			`ID: ${session.id}\n` +
			`Messages in session: ${session.messageCount}\n\n` +
			(recentMessages ? `Recent messages:\n${recentMessages}\n` : "No previous messages.\n") +
			`Continue the conversation!`,
	};
}

function showHistory(cwd: string): { success: boolean; message: string } {
	const sessions = loadSessions(cwd);
	const historyDir = path.join(cwd, ".pakalon-agents", "history");

	const changes: { timestamp: string; description: string; type: string }[] = [];
	if (fs.existsSync(historyDir)) {
		const files = fs
			.readdirSync(historyDir)
			.filter(f => f.endsWith(".json"))
			.sort()
			.reverse()
			.slice(0, 10);

		for (const file of files) {
			try {
				const entry = JSON.parse(fs.readFileSync(path.join(historyDir, file), "utf-8"));
				changes.push({
					timestamp: entry.timestamp,
					description: entry.description,
					type: entry.type,
				});
			} catch {
				/* skip */
			}
		}
	}

	const sessionSummary = sessions
		.slice(0, 5)
		.map(s => `- ${s.name} (${new Date(s.lastActive).toLocaleDateString()}) - ${s.messageCount} messages`)
		.join("\n");

	const changeSummary = changes
		.map(c => `- [${new Date(c.timestamp).toLocaleTimeString()}] ${c.type}: ${c.description}`)
		.join("\n");

	return {
		success: true,
		message:
			`History\n\n` +
			`Recent Sessions:\n${sessionSummary || "No sessions yet"}\n\n` +
			`Recent Changes:\n${changeSummary || "No changes recorded"}`,
	};
}

export default sessionCommand;

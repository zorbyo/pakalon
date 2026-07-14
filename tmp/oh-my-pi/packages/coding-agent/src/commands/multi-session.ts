/**
 * /multi-session command - Multi-session UI for parallel tasking
 */

import { logger } from "@oh-my-pi/pi-utils";
import type { CommandEntry } from "@oh-my-pi/pi-utils/cli";
import fs from "fs";
import path from "path";

const MULTI_SESSION_DIR = (cwd: string) => path.join(cwd, ".pakalon-agents", "multi-session");

export const multiSessionCommand: CommandEntry = {
	name: "multi-session",
	description: "Manage multiple sessions (parallel tasking UI)",
	usage: "/multi-session",
	async execute(_args: string[]) {
		const cwd = process.cwd();
		const multiDir = MULTI_SESSION_DIR(cwd);
		fs.mkdirSync(multiDir, { recursive: true });

		const sessions = listActiveSessions(cwd);

		if (sessions.length === 0) {
			return {
				success: true,
				message:
					"Multi-Session Manager\n\nNo active sessions.\n\nClick + or use /new to create a new session.\nEach session can run tasks in parallel.",
			};
		}

		const sessionList = sessions
			.map(
				(s, i) =>
					`${i + 1}. **${s.name}**\n` +
					`   ID: ${s.id}\n` +
					`   Status: ${s.status}\n` +
					`   Last active: ${new Date(s.lastActive).toLocaleTimeString()}\n`,
			)
			.join("\n");

		return {
			success: true,
			message:
				`Multi-Session Manager\n\nActive Sessions (${sessions.length}):\n\n${sessionList}\n\n` +
				`Controls:\n` +
				`   - Click session to interact\n` +
				`   - Click + to create new session\n` +
				`   - Blinking indicator = needs input\n` +
				`   - Spinner = running task\n\n` +
				`Tip: Use /new to add more sessions.`,
		};
	},
};

function listActiveSessions(cwd: string): { id: string; name: string; status: string; lastActive: string }[] {
	const multiDir = MULTI_SESSION_DIR(cwd);
	if (!fs.existsSync(multiDir)) {
		return [];
	}

	const sessions: { id: string; name: string; status: string; lastActive: string }[] = [];
	try {
		const files = fs.readdirSync(multiDir).filter(f => f.endsWith(".json"));
		for (const file of files) {
			try {
				const session = JSON.parse(fs.readFileSync(path.join(multiDir, file), "utf-8"));
				sessions.push(session);
			} catch {
				/* skip */
			}
		}
	} catch {
		/* skip */
	}

	sessions.sort((a, b) => new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime());

	return sessions.slice(0, 10);
}

export function createMultiSession(cwd: string, name: string): string {
	const multiDir = MULTI_SESSION_DIR(cwd);
	fs.mkdirSync(multiDir, { recursive: true });

	const id = `multi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const session = {
		id,
		name,
		status: "idle",
		created: new Date().toISOString(),
		lastActive: new Date().toISOString(),
	};

	fs.writeFileSync(path.join(multiDir, `${id}.json`), JSON.stringify(session, null, 2));
	return id;
}

export function updateMultiSessionStatus(
	cwd: string,
	sessionId: string,
	status: "idle" | "running" | "waiting-input",
): void {
	const multiDir = MULTI_SESSION_DIR(cwd);
	const sessionPath = path.join(multiDir, `${sessionId}.json`);

	if (!fs.existsSync(sessionPath)) {
		return;
	}

	try {
		const session = JSON.parse(fs.readFileSync(sessionPath, "utf-8"));
		session.status = status;
		session.lastActive = new Date().toISOString();
		fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
	} catch (err) {
		logger.warn("Failed to update multi-session status", { err });
	}
}

export default multiSessionCommand;

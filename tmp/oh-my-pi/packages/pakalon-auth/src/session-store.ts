/**
 * Session persistence for authentication state.
 * Stores auth sessions to disk for recovery across CLI restarts.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isEnoent, logger } from "@oh-my-pi/pi-utils";
import type { AuthSession } from "./types";

const AUTH_DIR = path.join(os.homedir(), ".config", "pakalon");
const AUTH_FILE = path.join(AUTH_DIR, "auth.json");
const SESSIONS_DIR = path.join(AUTH_DIR, "sessions");

/**
 * Save the current auth session to disk.
 */
export function saveAuthSession(session: AuthSession): void {
	try {
		fs.mkdirSync(AUTH_DIR, { recursive: true });
		fs.writeFileSync(AUTH_FILE, JSON.stringify(session, null, 2), "utf-8");
		logger.info("Auth session saved", { userId: session.userId, tier: session.tier });
	} catch (error) {
		logger.error("Failed to save auth session", { error });
	}
}

/**
 * Load the persisted auth session.
 */
export function loadAuthSession(): AuthSession | null {
	try {
		const raw = fs.readFileSync(AUTH_FILE, "utf-8");
		return JSON.parse(raw) as AuthSession;
	} catch (error) {
		if (isEnoent(error)) return null;
		logger.warn("Failed to load auth session", { error });
		return null;
	}
}

/**
 * Delete the persisted auth session (logout).
 */
export function deleteAuthSession(): void {
	try {
		if (fs.existsSync(AUTH_FILE)) fs.unlinkSync(AUTH_FILE);
		logger.info("Auth session deleted");
	} catch (error) {
		logger.warn("Failed to delete auth session", { error });
	}
}

/**
 * Save a named session for multi-session support.
 */
export function saveNamedSession(name: string, session: AuthSession): void {
	try {
		fs.mkdirSync(SESSIONS_DIR, { recursive: true });
		fs.writeFileSync(
			path.join(SESSIONS_DIR, `${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`),
			JSON.stringify(session, null, 2),
			"utf-8",
		);
	} catch (error) {
		logger.warn("Failed to save named session", { error, name });
	}
}

/**
 * List all saved sessions.
 */
export function listSavedSessions(): Array<{ name: string; userId: string; tier: string }> {
	try {
		if (!fs.existsSync(SESSIONS_DIR)) return [];
		return fs
			.readdirSync(SESSIONS_DIR)
			.filter(f => f.endsWith(".json"))
			.map(f => {
				try {
					const raw = fs.readFileSync(path.join(SESSIONS_DIR, f), "utf-8");
					const session = JSON.parse(raw) as AuthSession;
					return { name: f.replace(".json", ""), userId: session.userId, tier: session.tier };
				} catch {
					return null;
				}
			})
			.filter((s): s is NonNullable<typeof s> => s !== null);
	} catch (error) {
		logger.warn("Failed to list saved sessions", { error });
		return [];
	}
}

/**
 * Delete a named session.
 */
export function deleteNamedSession(name: string): void {
	try {
		const filePath = path.join(SESSIONS_DIR, `${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
		if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
	} catch (error) {
		logger.warn("Failed to delete named session", { error, name });
	}
}

/**
 * Check if an auth session exists.
 */
export function hasAuthSession(): boolean {
	return fs.existsSync(AUTH_FILE);
}

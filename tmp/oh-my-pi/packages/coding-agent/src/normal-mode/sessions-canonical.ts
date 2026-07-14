/**
 * Canonical session API for Pakalon.
 *
 * Re-exports the `normal-mode/sessions.ts` API (which is the per-
 * project session store). The legacy parallel systems (the v3 JSONL
 * `SessionManager` in `session/session-manager.ts` and the simple
 * in-memory `multi-session.ts`) are intentionally NOT exported here
 * — the slash commands and TUI now talk only to this one store.
 *
 * Usage:
 *   import { createSession, listSessions, resumeSession } from "@/normal-mode/sessions-canonical";
 */

export type { Message, Session, SessionStatus, SessionSummary } from "./sessions";
export {
	addMessage,
	addTags,
	archiveSession,
	clearMessages,
	completeSession,
	createSession,
	deleteSession,
	filterByTag,
	formatSession,
	formatSessionList,
	getActiveSession,
	getMessages,
	getSession,
	listSessions,
	pauseSession,
	removeTags,
	resumeSession,
	saveSession,
	searchMessages,
} from "./sessions";

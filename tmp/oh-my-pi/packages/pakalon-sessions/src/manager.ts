import { logger } from "@oh-my-pi/pi-utils";
import type { Session, SessionStatus, SessionSummary } from "./types";

export class SessionManager {
	private sessions: Map<string, Session> = new Map();
	private maxSessions = 50;

	createSession(name: string, projectDir: string): Session {
		const session: Session = {
			id: crypto.randomUUID(),
			name,
			projectDir,
			status: "active",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			lastActivityAt: new Date().toISOString(),
			messageCount: 0,
			tokenCount: 0,
			metadata: {},
		};
		this.sessions.set(session.id, session);
		this.enforceLimit();
		logger.info("Session created", { id: session.id, name });
		return session;
	}

	getSession(id: string): Session | undefined {
		return this.sessions.get(id);
	}

	getAllSessions(): Session[] {
		return [...this.sessions.values()];
	}

	listSessions(): SessionSummary[] {
		return this.getAllSessions().map(s => ({
			id: s.id,
			name: s.name,
			status: s.status,
			createdAt: s.createdAt,
			messageCount: s.messageCount,
			tokenCount: s.tokenCount,
		}));
	}

	updateSessionStatus(id: string, status: SessionStatus): boolean {
		const session = this.sessions.get(id);
		if (!session) return false;
		session.status = status;
		session.updatedAt = new Date().toISOString();
		return true;
	}

	recordActivity(id: string): boolean {
		const session = this.sessions.get(id);
		if (!session) return false;
		session.lastActivityAt = new Date().toISOString();
		session.messageCount++;
		return true;
	}

	recordTokens(id: string, tokens: number): boolean {
		const session = this.sessions.get(id);
		if (!session) return false;
		session.tokenCount += tokens;
		session.updatedAt = new Date().toISOString();
		return true;
	}

	deleteSession(id: string): boolean {
		return this.sessions.delete(id);
	}

	getActiveSessions(): Session[] {
		return this.getAllSessions().filter(s => s.status === "active");
	}

	count(): number {
		return this.sessions.size;
	}

	private enforceLimit(): void {
		if (this.sessions.size > this.maxSessions) {
			const sorted = [...this.sessions.values()].sort(
				(a, b) => new Date(a.lastActivityAt).getTime() - new Date(b.lastActivityAt).getTime(),
			);
			const toRemove = sorted.slice(0, this.sessions.size - this.maxSessions);
			for (const s of toRemove) {
				this.sessions.delete(s.id);
				logger.debug("Session removed (limit)", { id: s.id });
			}
		}
	}
}

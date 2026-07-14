import { z } from "zod";

export type SessionStatus = "active" | "paused" | "completed" | "archived";

export interface Session {
	id: string;
	name: string;
	projectDir: string;
	status: SessionStatus;
	createdAt: string;
	updatedAt: string;
	lastActivityAt: string;
	messageCount: number;
	tokenCount: number;
	metadata: Record<string, unknown>;
}

export interface SessionSummary {
	id: string;
	name: string;
	status: SessionStatus;
	createdAt: string;
	messageCount: number;
	tokenCount: number;
}

export const SessionSchema = z.object({
	id: z.string(),
	name: z.string(),
	projectDir: z.string(),
	status: z.enum(["active", "paused", "completed", "archived"]),
	createdAt: z.string(),
	updatedAt: z.string(),
	lastActivityAt: z.string(),
	messageCount: z.number(),
	tokenCount: z.number(),
	metadata: z.record(z.unknown()),
});

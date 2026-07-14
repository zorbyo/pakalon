import { z } from "zod";

export type MemoryBackend = "off" | "local" | "hindsight";

export interface MemoryEntry {
	id: string;
	content: string;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
	scope: string;
}

export interface MemoryQuery {
	query: string;
	limit?: number;
	scope?: string;
}

export interface MemoryBank {
	id: string;
	name: string;
	mission: string;
	entries: MemoryEntry[];
}

export const MemoryEntrySchema = z.object({
	id: z.string(),
	content: z.string(),
	metadata: z.record(z.unknown()),
	createdAt: z.string(),
	updatedAt: z.string(),
	scope: z.string(),
});

export const MemoryQuerySchema = z.object({
	query: z.string(),
	limit: z.number().optional(),
	scope: z.string().optional(),
});

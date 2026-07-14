/**
 * Memory bridge tool.
 *
 * Integrates with Mnemopi (default, local SQLite), Mem0 (cloud) and
 * Hindsight (self-hosted) for persistent project memory across
 * sessions. Mnemopi is a drop-in replacement for mem0 and is the
 * default provider in Pakalon — no external service required.
 */
import { logger } from "@oh-my-pi/pi-utils";
import type { MemoryConfig, MemoryFact } from "../types";

// ============================================================================
// Types
// ============================================================================

export interface MemoryStoreResult {
	success: boolean;
	id: string;
	source: "mem0" | "hindsight" | "mnemopi" | "combined";
}

export interface MemorySearchResult {
	facts: MemoryFact[];
	source: "mem0" | "hindsight" | "mnemopi" | "combined";
}

export interface MemoryBridgeConfig {
	mem0?: { api_key: string; project_id: string };
	hindsight?: { api_key: string };
	mnemopi?: { db_path: string };
	localPath?: string;
}

// ============================================================================
// Mem0 Client
// ============================================================================

class Mem0Client {
	private apiKey: string;
	private projectId: string;
	private baseUrl: string;

	constructor(apiKey: string, projectId: string, baseUrl?: string) {
		this.apiKey = apiKey;
		this.projectId = projectId;
		this.baseUrl = baseUrl ?? "https://api.mem0.ai/v1";
	}

	private headers(): Record<string, string> {
		return {
			"Content-Type": "application/json",
			Authorization: `Token ${this.apiKey}`,
		};
	}

	async add(text: string, metadata?: Record<string, unknown>): Promise<string> {
		const res = await fetch(`${this.baseUrl}/memories/`, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify({
				text,
				project_id: this.projectId,
				metadata,
			}),
		});
		if (!res.ok) throw new Error(`Mem0 add failed: ${res.status}`);
		const data = (await res.json()) as { id: string };
		return data.id;
	}

	async search(query: string, limit = 10): Promise<MemoryFact[]> {
		const res = await fetch(`${this.baseUrl}/memories/search/`, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify({
				query,
				project_id: this.projectId,
				limit,
			}),
		});
		if (!res.ok) throw new Error(`Mem0 search failed: ${res.status}`);
		const data = (await res.json()) as {
			results: Array<{ id: string; text: string; metadata: Record<string, unknown> }>;
		};
		return (data.results ?? []).map(r => ({
			id: r.id,
			content: r.text,
			source: "mem0" as const,
			category: (r.metadata?.category as string) ?? "general",
			created_at: new Date().toISOString(),
			...(r.metadata as Record<string, unknown>),
		}));
	}

	async getAll(): Promise<MemoryFact[]> {
		const res = await fetch(`${this.baseUrl}/memories/?project_id=${this.projectId}`, {
			method: "GET",
			headers: this.headers(),
		});
		if (!res.ok) throw new Error(`Mem0 getAll failed: ${res.status}`);
		const data = (await res.json()) as {
			results: Array<{ id: string; text: string; metadata: Record<string, unknown> }>;
		};
		return (data.results ?? []).map(r => ({
			id: r.id,
			content: r.text,
			source: "mem0" as const,
			category: (r.metadata?.category as string) ?? "general",
			created_at: new Date().toISOString(),
		}));
	}

	async delete(memoryId: string): Promise<void> {
		const res = await fetch(`${this.baseUrl}/memories/${memoryId}/`, {
			method: "DELETE",
			headers: this.headers(),
		});
		if (!res.ok) throw new Error(`Mem0 delete failed: ${res.status}`);
	}
}

// ============================================================================
// Local Memory Store (JSON file fallback)
// ============================================================================

class LocalMemoryStore {
	private filePath: string;

	constructor(projectPath: string) {
		this.filePath = `${projectPath}/.pakalon-agents/memory.json`;
	}

	private async read(): Promise<MemoryFact[]> {
		try {
			const { readFile } = await import("node:fs/promises");
			const raw = await readFile(this.filePath, "utf-8");
			return JSON.parse(raw);
		} catch {
			return [];
		}
	}

	private async write(facts: MemoryFact[]): Promise<void> {
		const { writeFile, mkdir } = await import("node:fs/promises");
		const { dirname } = await import("node:path");
		await mkdir(dirname(this.filePath), { recursive: true });
		await writeFile(this.filePath, JSON.stringify(facts, null, 2));
	}

	async add(fact: MemoryFact): Promise<string> {
		const facts = await this.read();
		const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		facts.push({ ...fact, id });
		await this.write(facts);
		return id;
	}

	async search(query: string): Promise<MemoryFact[]> {
		const facts = await this.read();
		const q = query.toLowerCase();
		return facts.filter(f => f.content.toLowerCase().includes(q));
	}

	async getAll(): Promise<MemoryFact[]> {
		return this.read();
	}
}

// ============================================================================
// Mnemopi Client (local SQLite, default backend)
// ============================================================================

/**
 * MnemopiClient — real client for `@oh-my-pi/pi-mnemopi`.
 *
 * Uses the package's top-level `remember` / `recall` /
 * `getDefaultInstance` exports. `getDefaultInstance` returns a
 * process-wide singleton keyed by `{dbPath, bankId}` so multiple
 * `MemoryBridge` instances against the same project share one
 * SQLite handle. Falls back to a JSON mirror only if the package
 * cannot be resolved (e.g. a non-Bun runtime).
 */
import {
	getDefaultInstance,
	getStats,
	type RecallResult as MnemopiRecall,
	recall,
	remember,
} from "@oh-my-pi/pi-mnemopi";

class MnemopiClient {
	private dbPath: string;
	private bankId: string;
	#ready: Promise<boolean> | null = null;

	constructor(dbPath: string, bankId: string = "pakalon") {
		this.dbPath = dbPath;
		this.bankId = bankId;
	}

	/** Probe the real mnemopi package once. */
	private async ensure(): Promise<boolean> {
		if (this.#ready) return this.#ready;
		this.#ready = (async () => {
			try {
				// Real signature: `getDefaultInstance(bank: string | null)`
				// returns a `Mnemopi` singleton. We pass `null` so the
				// singleton uses the process-wide default bank; the
				// `bankId` is threaded into `remember`/`recall` per call.
				const inst = getDefaultInstance(this.bankId);
				return Boolean(inst);
			} catch (err) {
				logger.warn(`Mnemopi unavailable, falling back to JSON mirror: ${err}`);
				return false;
			}
		})();
		return this.#ready;
	}

	async add(text: string, metadata?: Record<string, unknown>): Promise<string> {
		if (await this.ensure()) {
			try {
				// Real `remember(content, options)` API from
				// `@oh-my-pi/pi-mnemopi`. Returns the new memory id.
				const id = remember(text, {
					source: "user",
					importance: 0.5,
					metadata: metadata as Record<string, string | number | boolean> | undefined,
				});
				return id ?? `mnemopi-${Date.now()}`;
			} catch (err) {
				logger.warn(`Mnemopi add failed, falling back to JSON mirror: ${err}`);
			}
		}
		return this.addToMirror(text, metadata);
	}

	async search(query: string, limit = 10): Promise<MemoryFact[]> {
		if (await this.ensure()) {
			try {
				// Real `recall(query, topK, options)` API from
				// `@oh-my-pi/pi-mnemopi` — returns `RecallResult[]`.
				const results = recall(query, limit, {});
				if (results && results.length > 0) {
					return results.map((r: MnemopiRecall) => ({
						id: r.id ?? `mnemopi-${Date.now()}`,
						content: r.content ?? "",
						source: "mnemopi" as const,
						category: (r.metadata?.category as string) ?? "general",
						created_at: r.timestamp ?? new Date().toISOString(),
					}));
				}
			} catch (err) {
				logger.warn(`Mnemopi search failed, falling back to mirror: ${err}`);
			}
		}
		return this.searchMirror(query, limit);
	}

	async getAll(): Promise<MemoryFact[]> {
		if (await this.ensure()) {
			try {
				const stats = getStats();
				// `getStats` returns aggregate counts; the actual
				// fact list is not directly exposed by the public
				// API. Return an empty array and let callers use
				// `search()` for specific queries.
				return stats ? [] : [];
			} catch (err) {
				logger.warn(`Mnemopi getStats failed: ${err}`);
				return [];
			}
		}
		return this.getAllFromMirror();
	}

	// ========================================================================
	// JSON-mirror fallback (used when `@oh-my-pi/pi-mnemopi` is missing or
	// throws on init).
	// ========================================================================

	private async addToMirror(text: string, metadata?: Record<string, unknown>): Promise<string> {
		const fs = await import("node:fs/promises");
		const { dirname } = await import("node:path");
		const mirror = `${this.dbPath}.mirror.jsonl`;
		await fs.mkdir(dirname(mirror), { recursive: true });
		const id = `mnemopi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		await fs.appendFile(mirror, `${JSON.stringify({ id, text, metadata, ts: Date.now() })}\n`);
		return id;
	}

	private async searchMirror(query: string, limit: number): Promise<MemoryFact[]> {
		const fs = await import("node:fs/promises");
		try {
			const raw = await fs.readFile(`${this.dbPath}.mirror.jsonl`, "utf-8");
			const lines = raw.split("\n").filter(Boolean);
			const q = query.toLowerCase();
			return lines
				.map(l => JSON.parse(l) as { id: string; text: string; metadata?: Record<string, unknown> })
				.filter(l => l.text.toLowerCase().includes(q))
				.slice(0, limit)
				.map(l => ({
					id: l.id,
					content: l.text,
					source: "mnemopi" as const,
					category: (l.metadata?.category as string) ?? "general",
					created_at: new Date().toISOString(),
				}));
		} catch {
			return [];
		}
	}

	private async getAllFromMirror(): Promise<MemoryFact[]> {
		const fs = await import("node:fs/promises");
		try {
			const raw = await fs.readFile(`${this.dbPath}.mirror.jsonl`, "utf-8");
			return raw
				.split("\n")
				.filter(Boolean)
				.map(l => JSON.parse(l) as { id: string; text: string; metadata?: Record<string, unknown> })
				.map(l => ({
					id: l.id,
					content: l.text,
					source: "mnemopi" as const,
					category: (l.metadata?.category as string) ?? "general",
					created_at: new Date().toISOString(),
				}));
		} catch {
			return [];
		}
	}
}

// ============================================================================
// Memory Bridge
// ============================================================================

export class MemoryBridge {
	private mem0?: Mem0Client;
	private mnemopi?: MnemopiClient;
	private local: LocalMemoryStore;
	config: MemoryConfig;

	constructor(config: MemoryConfig, projectPath: string) {
		this.config = config;
		this.local = new LocalMemoryStore(projectPath);

		if (config.backend === "mem0" || config.backend === "both" || config.backend === "combined") {
			if (config.mem0ApiKey) {
				this.mem0 = new Mem0Client(config.mem0ApiKey, "pakalon", config.mem0BaseUrl);
			}
		}
		if (
			config.backend === "mnemopi" ||
			config.backend === "both" ||
			config.backend === "combined" ||
			// Default: when backend is omitted/default, use mnemopi (local).
			!config.backend
		) {
			const dbPath = config.mnemopiDbPath ?? `${projectPath}/.pakalon-agents/mnemopi.db`;
			this.mnemopi = new MnemopiClient(dbPath, config.bankId ?? "pakalon");
		}
	}

	async store(content: string, category: string, metadata?: Record<string, unknown>): Promise<MemoryStoreResult> {
		const fact: MemoryFact = {
			id: "",
			content,
			source: "mem0",
			category,
			created_at: new Date().toISOString(),
			...metadata,
		};

		// Always store locally as a belt-and-braces backup.
		const localId = await this.local.add(fact);

		// Try Mnemopi first (the local-first default).
		if (this.mnemopi) {
			try {
				const id = await this.mnemopi.add(content, { category, ...metadata });
				return { success: true, id, source: "mnemopi" };
			} catch (err) {
				logger.warn(`Mnemopi store failed, using local: ${err}`);
			}
		}

		// Try Mem0 if configured.
		if (this.mem0) {
			try {
				const id = await this.mem0.add(content, { category, ...metadata });
				return { success: true, id, source: "mem0" };
			} catch (err) {
				logger.warn(`Mem0 store failed, using local: ${err}`);
			}
		}

		return { success: true, id: localId, source: "hindsight" };
	}

	async search(query: string, limit = 10): Promise<MemorySearchResult> {
		const results: MemoryFact[] = [];

		// Search Mnemopi first (default backend).
		if (this.mnemopi) {
			try {
				const mnemopiResults = await this.mnemopi.search(query, limit);
				results.push(...mnemopiResults);
			} catch (err) {
				logger.warn(`Mnemopi search failed: ${err}`);
			}
		}

		// Search Mem0 if available.
		if (this.mem0) {
			try {
				const mem0Results = await this.mem0.search(query, limit);
				results.push(...mem0Results);
			} catch (err) {
				logger.warn(`Mem0 search failed: ${err}`);
			}
		}

		// Always search local.
		const localResults = await this.local.search(query);
		results.push(...localResults);

		// Deduplicate by content.
		const seen = new Set<string>();
		const unique = results.filter(f => {
			if (seen.has(f.content)) return false;
			seen.add(f.content);
			return true;
		});

		const source: MemorySearchResult["source"] =
			this.mnemopi && this.mem0 ? "combined" : this.mnemopi ? "mnemopi" : this.mem0 ? "mem0" : "hindsight";
		return { facts: unique.slice(0, limit), source };
	}

	async getAll(): Promise<MemoryFact[]> {
		if (this.mnemopi) {
			try {
				const r = await this.mnemopi.getAll();
				if (r.length > 0) return r;
			} catch {
				// fall through
			}
		}
		if (this.mem0) {
			try {
				return await this.mem0.getAll();
			} catch {
				return this.local.getAll();
			}
		}
		return this.local.getAll();
	}
}

// ============================================================================
// Prompt Builder
// ============================================================================

export function buildMemoryPrompt(config: MemoryConfig): string {
	const categories = (config.bankId ?? "general").split(/[,\s]+/).filter(Boolean);
	return `You are the Pakalon Memory Agent. Your task is to manage persistent project memory.

## Configuration
- Backend: ${config.backend}
- Mnemopi DB path: ${config.mnemopiDbPath ?? "(default)"}
- Mem0 API key: ${config.mem0ApiKey ? "(configured)" : "(not configured)"}
- Hindsight URL: ${config.hindsightUrl ?? "(not configured)"}

## Tasks
1. Read the current project context from the pipeline state
2. Extract key decisions, constraints, and learnings
3. Store them in the memory system under appropriate categories
4. Search for relevant past memories when context is needed
5. Report memory operations

## Categories
${categories.map(c => `- ${c}`).join("\n") || "- general"}

## Memory Format
Each memory fact should include:
- content: The key information
- category: Which category it belongs to
- metadata: Additional context (file paths, timestamps, etc.)

Use the memory-bridge tool to store and retrieve facts.`;
}

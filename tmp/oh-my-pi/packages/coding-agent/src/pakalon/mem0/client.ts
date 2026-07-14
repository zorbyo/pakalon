/**
 * Mem0 cloud client for Pakalon.
 *
 * Per CLI-req.md §619, Q&A answers and per-phase artifacts must be
 * persisted to Mem0 so the agent can recall them across phases/sessions.
 *
 * Activates when `MEM0_API_KEY` is set (otherwise writes are no-ops
 * and the in-tree `qa-runner` / `hindsight` local persistence remains
 * the source of truth). This keeps the CLI usable offline while
 * shipping the full spec-conformant integration when a key is present.
 */
import { logger } from "@oh-my-pi/pi-utils";

const MEM0_API_BASE = process.env.MEM0_API_BASE ?? "https://api.mem0.ai/v1";

export interface Mem0AddPayload {
	/** Stable memory id; we use it to make the call idempotent. */
	id?: string;
	/** Free-form content. */
	content: string;
	/** User id (required by Mem0 for multi-tenant isolation). */
	userId: string;
	/** Optional structured metadata. */
	metadata?: Record<string, unknown>;
}

export interface Mem0SearchPayload {
	query: string;
	userId: string;
	topK?: number;
	filters?: Record<string, unknown>;
}

export interface Mem0Memory {
	id: string;
	content: string;
	metadata?: Record<string, unknown>;
	score?: number;
	createdAt?: string;
}

export interface Mem0ClientOptions {
	apiKey?: string;
	/** Override for tests. */
	baseUrl?: string;
}

let cached: Mem0Client | null = null;

export function getMem0Client(opts: Mem0ClientOptions = {}): Mem0Client {
	if (cached) return cached;
	cached = new Mem0Client({ apiKey: opts.apiKey ?? process.env.MEM0_API_KEY, baseUrl: opts.baseUrl });
	return cached;
}

/** Reset the cached client (used by tests). */
export function resetMem0Client(): void {
	cached = null;
}

export class Mem0Client {
	readonly apiKey: string | undefined;
	readonly baseUrl: string;
	readonly enabled: boolean;

	constructor(opts: Mem0ClientOptions = {}) {
		this.apiKey = opts.apiKey;
		this.baseUrl = (opts.baseUrl ?? MEM0_API_BASE).replace(/\/$/, "");
		this.enabled = Boolean(this.apiKey);
		if (!this.enabled) {
			logger.debug("mem0: disabled (no MEM0_API_KEY); calls become no-ops");
		}
	}

	/**
	 * Persist a memory to Mem0. Returns the assigned id, or null when
	 * Mem0 is disabled (so callers can still proceed with local storage).
	 */
	async add(payload: Mem0AddPayload): Promise<string | null> {
		if (!this.enabled || !this.apiKey) return null;
		try {
			const resp = await fetch(`${this.baseUrl}/memories/`, {
				method: "POST",
				headers: {
					authorization: `Token ${this.apiKey}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					messages: [{ role: "user", content: payload.content }],
					user_id: payload.userId,
					metadata: payload.metadata ?? {},
					...(payload.id ? { memory_id: payload.id } : {}),
				}),
				signal: AbortSignal.timeout(15_000),
			});
			if (!resp.ok) {
				logger.warn("mem0.add failed", { status: resp.status, userId: payload.userId });
				return null;
			}
			const data = (await resp.json()) as { id?: string; memory_id?: string };
			return data.id ?? data.memory_id ?? null;
		} catch (err) {
			logger.warn("mem0.add error", { err });
			return null;
		}
	}

	/**
	 * Semantic search over the user's memories. Returns an empty array
	 * when Mem0 is disabled or the request fails (graceful degradation).
	 */
	async search(payload: Mem0SearchPayload): Promise<Mem0Memory[]> {
		if (!this.enabled || !this.apiKey) return [];
		try {
			const resp = await fetch(`${this.baseUrl}/memories/search/`, {
				method: "POST",
				headers: {
					authorization: `Token ${this.apiKey}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					query: payload.query,
					user_id: payload.userId,
					top_k: payload.topK ?? 8,
					...(payload.filters ? { filters: payload.filters } : {}),
				}),
				signal: AbortSignal.timeout(15_000),
			});
			if (!resp.ok) {
				logger.warn("mem0.search failed", { status: resp.status, userId: payload.userId });
				return [];
			}
			const data = (await resp.json()) as { results?: Mem0Memory[] };
			return Array.isArray(data.results) ? data.results : [];
		} catch (err) {
			logger.warn("mem0.search error", { err });
			return [];
		}
	}

	/** Best-effort delete; missing ids are tolerated. */
	async delete(id: string): Promise<boolean> {
		if (!this.enabled || !this.apiKey) return false;
		try {
			const resp = await fetch(`${this.baseUrl}/memories/${encodeURIComponent(id)}/`, {
				method: "DELETE",
				headers: { authorization: `Token ${this.apiKey}` },
				signal: AbortSignal.timeout(15_000),
			});
			return resp.ok || resp.status === 404;
		} catch (err) {
			logger.warn("mem0.delete error", { id, err });
			return false;
		}
	}
}

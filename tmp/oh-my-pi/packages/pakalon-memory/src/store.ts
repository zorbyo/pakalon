import { logger } from "@oh-my-pi/pi-utils";
import type { MemoryBackend, MemoryEntry, MemoryQuery } from "./types";

export class MemoryStore {
	private backend: MemoryBackend = "off";
	private entries: MemoryEntry[] = [];
	private maxEntries = 1000;

	constructor(backend: MemoryBackend = "off") {
		this.backend = backend;
	}

	setBackend(backend: MemoryBackend): void {
		this.backend = backend;
		logger.info("Memory backend set", { backend });
	}

	getBackend(): MemoryBackend {
		return this.backend;
	}

	async retain(content: string, metadata?: Record<string, unknown>, scope?: string): Promise<MemoryEntry> {
		const entry: MemoryEntry = {
			id: crypto.randomUUID(),
			content,
			metadata: metadata ?? {},
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			scope: scope ?? "default",
		};
		this.entries.push(entry);
		if (this.entries.length > this.maxEntries) {
			this.entries = this.entries.slice(-this.maxEntries);
		}
		logger.debug("Memory retained", { id: entry.id, scope: entry.scope });
		return entry;
	}

	async recall(query: MemoryQuery): Promise<MemoryEntry[]> {
		const results = this.entries.filter(e => {
			if (query.scope && e.scope !== query.scope) return false;
			return e.content.toLowerCase().includes(query.query.toLowerCase());
		});
		const limit = query.limit ?? 10;
		return results.slice(0, limit);
	}

	async reflect(question: string): Promise<string> {
		const relevant = await this.recall({ query: question, limit: 20 });
		if (relevant.length === 0) return "No relevant memories found.";
		return relevant.map(e => `- ${e.content}`).join("\n");
	}

	async getEntry(id: string): Promise<MemoryEntry | undefined> {
		return this.entries.find(e => e.id === id);
	}

	async deleteEntry(id: string): Promise<boolean> {
		const len = this.entries.length;
		this.entries = this.entries.filter(e => e.id !== id);
		return this.entries.length < len;
	}

	async clear(scope?: string): Promise<void> {
		if (scope) {
			this.entries = this.entries.filter(e => e.scope !== scope);
		} else {
			this.entries = [];
		}
	}

	async count(scope?: string): Promise<number> {
		if (scope) return this.entries.filter(e => e.scope === scope).length;
		return this.entries.length;
	}

	isEnabled(): boolean {
		return this.backend !== "off";
	}
}

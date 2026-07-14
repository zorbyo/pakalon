/**
 * Default vector-store backend for Pakalon.
 *
 * In-process + JSON persistence under `~/.pakalon/vector-store/<namespace>.json`.
 * Works offline with no external dependency, making it the default for
 * both cloud and self-hosted modes.
 *
 * The same interface as a ChromaDB / LanceDB adapter, so it can be
 * swapped without changing callers.
 */
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { cosine } from "./distance";
import type { VectorFilter, VectorMatch, VectorRecord, VectorStore } from "./types";

const DEFAULT_DIR = process.env.PAKALON_VECTOR_STORE_DIR ?? `${process.env.HOME ?? "/tmp"}/.pakalon/vector-store`;

export class MemoryVectorStore implements VectorStore {
	#namespace: string;
	#filePath: string;
	#records = new Map<string, VectorRecord>();
	#loaded = false;

	constructor(namespace: string, dir: string = DEFAULT_DIR) {
		this.#namespace = namespace;
		this.#filePath = path.join(dir, `${namespace}.json`);
	}

	async #load(): Promise<void> {
		if (this.#loaded) return;
		try {
			const raw = await fsPromises.readFile(this.#filePath, "utf8");
			const parsed = JSON.parse(raw) as { records?: VectorRecord[] };
			if (Array.isArray(parsed.records)) {
				for (const r of parsed.records) {
					if (r.id && Array.isArray(r.embedding)) {
						this.#records.set(r.id, r);
					}
				}
			}
			logger.debug("vector-store: loaded", { namespace: this.#namespace, count: this.#records.size });
		} catch (err) {
			// File not existing is the common case (first run); only warn on real parse failures.
			if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
				logger.warn("vector-store: failed to load, starting empty", { file: this.#filePath, err });
			}
		}
		this.#loaded = true;
	}

	async upsert(records: VectorRecord[]): Promise<void> {
		await this.#load();
		for (const r of records) {
			if (!r.id || !Array.isArray(r.embedding)) continue;
			this.#records.set(r.id, r);
		}
	}

	async query(embedding: number[], k: number, filter?: VectorFilter): Promise<VectorMatch[]> {
		await this.#load();
		const filterEntries = filter ? Object.entries(filter) : [];
		const out: VectorMatch[] = [];
		for (const r of this.#records.values()) {
			if (filterEntries.length > 0) {
				let ok = true;
				for (const [key, val] of filterEntries) {
					if (r.metadata[key] !== val) {
						ok = false;
						break;
					}
				}
				if (!ok) continue;
			}
			out.push({
				id: r.id,
				score: cosine(embedding, r.embedding),
				text: r.text,
				metadata: r.metadata,
			});
		}
		out.sort((a, b) => b.score - a.score);
		return out.slice(0, k);
	}

	async count(): Promise<number> {
		await this.#load();
		return this.#records.size;
	}

	async flush(): Promise<void> {
		await fsPromises.mkdir(path.dirname(this.#filePath), { recursive: true });
		const payload = JSON.stringify(
			{ namespace: this.#namespace, records: Array.from(this.#records.values()) },
			null,
			2,
		);
		await fsPromises.writeFile(this.#filePath, `${payload}\n`);
	}

	async close(): Promise<void> {
		await this.flush();
	}
}

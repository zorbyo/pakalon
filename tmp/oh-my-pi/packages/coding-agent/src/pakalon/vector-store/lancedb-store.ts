/**
 * LanceDB adapter for Pakalon's vector store.
 *
 * Activates when the `lancedb` package is installed. Mirrors the
 * `VectorStore` interface so callers don't need to know which backend
 * is active. Falls back to `MemoryVectorStore` if `lancedb` is not
 * installed.
 *
 * Per CLI-req.md §215, this is one of the two named vector databases
 * (alongside ChromaDB) that power attached-file RAG.
 *
 * To enable:
 *   bun add lancedb
 *   (then `startVectorStore({ backend: "lancedb" })` will use it)
 */
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { MemoryVectorStore } from "./memory-store";
import type { VectorFilter, VectorMatch, VectorRecord, VectorStore } from "./types";

/**
 * Minimal interface for the LanceDB surface we use. Avoids a hard
 * static import so the package stays optional. The actual LanceDB
 * export shape is richer; we only need `connect` + the table API.
 */
interface LanceDBShim {
	connect(uri: string): Promise<LanceDBConnection>;
}

interface LanceDBConnection {
	tableNames(): Promise<string[]>;
	createTable(name: string, data: object[]): Promise<LanceDBTable>;
	openTable(name: string): Promise<LanceDBTable>;
}

interface LanceDBTable {
	add(data: object[]): Promise<unknown>;
	search(vector: number[]): {
		limit(n: number): Promise<Array<{ id: string; text: string; metadata: string; score: number }>>;
	};
}

/** Try to construct a LanceDB-backed store. Returns null when the package is missing. */
async function tryLanceDB(opts: StartVectorStoreOptions): Promise<VectorStore | null> {
	const mod = (await import("lancedb" as string).catch(() => null)) as LanceDBShim | null;
	if (!mod) return null;
	const dir = opts.dir ?? `${process.env.HOME ?? "/tmp"}/.pakalon/vector-store/lancedb`;
	await fsPromises.mkdir(dir, { recursive: true });
	const conn = await mod.connect(dir);
	const tableName = opts.namespace;
	const existing = await conn.tableNames();
	const table: LanceDBTable = existing.includes(tableName)
		? await conn.openTable(tableName)
		: await conn.createTable(tableName, [{ id: "__init__", vector: [0], text: "", metadata: "{}" }]);
	logger.info("vector-store: lanceDB active", { namespace: tableName, dir });

	const adapter: VectorStore = {
		async upsert(records: VectorRecord[]) {
			const rows = records.map(r => ({
				id: r.id,
				vector: r.embedding,
				text: r.text,
				metadata: JSON.stringify(r.metadata),
			}));
			await table.add(rows);
		},
		async query(embedding, k, filter) {
			const all = await table.search(embedding).limit(k * 2);
			let out: VectorMatch[] = all.map(m => ({
				id: m.id,
				score: 1 - (m.score ?? 0), // lancedb returns L2 distance; convert to similarity-ish
				text: m.text,
				metadata: safeParse(m.metadata),
			}));
			if (filter) {
				out = out.filter(m => matchesFilter(m.metadata, filter));
			}
			out.sort((a, b) => b.score - a.score);
			return out.slice(0, k);
		},
		async count() {
			try {
				const rows = await table.search([0]).limit(1);
				return rows.length;
			} catch {
				return 0;
			}
		},
		async close() {
			// LanceDB connections are persistent; nothing to close in JS land.
		},
	};
	return adapter;
}

function safeParse(s: string): Record<string, unknown> {
	try {
		const obj = JSON.parse(s);
		return typeof obj === "object" && obj !== null ? (obj as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

function matchesFilter(meta: Record<string, unknown>, filter: VectorFilter): boolean {
	for (const [k, v] of Object.entries(filter)) {
		if (meta[k] !== v) return false;
	}
	return true;
}

export type VectorStoreBackend = "memory" | "lancedb";

export interface StartVectorStoreOptions {
	backend?: VectorStoreBackend;
	namespace: string;
	dir?: string;
}

/**
 * Pick the right backend and return a ready-to-use store.
 * Falls back to `MemoryVectorStore` when the requested backend is
 * unavailable.
 */
export async function startVectorStore(opts: StartVectorStoreOptions): Promise<VectorStore> {
	const backend = opts.backend ?? "memory";
	if (backend === "lancedb") {
		const store = await tryLanceDB(opts);
		if (store) return store;
		logger.warn("vector-store: lanceDB requested but unavailable; using memory backend");
	}
	const dir = opts.dir ?? path.join(process.env.HOME ?? "/tmp", ".pakalon", "vector-store");
	return new MemoryVectorStore(opts.namespace, dir);
}

/**
 * Lazily-created singleton keyed by namespace. Used by the bridge
 * module to keep one store per (user, project).
 */
const cached = new Map<string, Promise<VectorStore>>();

export function getVectorStore(
	namespace: string,
	opts: Omit<StartVectorStoreOptions, "namespace"> = {},
): Promise<VectorStore> {
	const key = `${opts.backend ?? "memory"}:${namespace}`;
	let p = cached.get(key);
	if (!p) {
		p = startVectorStore({ ...opts, namespace });
		cached.set(key, p);
	}
	return p;
}

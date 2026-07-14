/**
 * Registry-RAG search.
 *
 * Performs Jaccard-similarity search over the curated components
 * index, optionally fetches the entry's source from `fetcher.ts`,
 * and returns the top-K hits with the code snippet ready to be
 * injected into the LLM context.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { fetchEntry } from "./fetcher";
import index from "./registry.json" with { type: "json" };

export interface RegistryEntry {
	id: string;
	name: string;
	url: string;
	semantic: string;
	snippet: string;
	imports: string[];
	tags: string[];
}

export interface RegistryHit {
	entry: RegistryEntry;
	score: number;
	code: string;
}

const ALL_ENTRIES: RegistryEntry[] = (index as { entries: RegistryEntry[] }).entries;

function tokenize(s: string): Set<string> {
	return new Set(
		s
			.toLowerCase()
			.replace(/[^a-z0-9\s-]+/g, " ")
			.split(/\s+/)
			.filter(w => w.length >= 3),
	);
}

function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 || b.size === 0) return 0;
	let inter = 0;
	for (const t of a) if (b.has(t)) inter++;
	return inter / (a.size + b.size - inter);
}

function entryTokens(entry: RegistryEntry): Set<string> {
	return new Set([...tokenize(entry.semantic), ...tokenize(entry.name), ...entry.tags.map(t => t.toLowerCase())]);
}

/**
 * Pure-local search (no fetch). Faster than the wrapped `queryRegistry`
 * in `tools/registry-rag.ts` because it skips the model-resolve step.
 */
export function searchRegistry(query: string, topK: number = 5): RegistryHit[] {
	const qTokens = tokenize(query);
	const scored: RegistryHit[] = [];
	for (const entry of ALL_ENTRIES) {
		const score = jaccard(qTokens, entryTokens(entry));
		if (score > 0) {
			scored.push({ entry, score, code: entry.snippet });
		}
	}
	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, topK);
}

/**
 * Search + fetch: same as `searchRegistry` but also fetches the
 * full source code for each hit. Returns the same shape.
 */
export async function searchAndFetchRegistry(query: string, topK: number = 5): Promise<RegistryHit[]> {
	const hits = searchRegistry(query, topK);
	const out: RegistryHit[] = [];
	for (const h of hits) {
		try {
			const code = await fetchEntry(h.entry.id, h.entry.snippet, h.entry.url);
			out.push({ entry: h.entry, score: h.score, code });
		} catch (err) {
			logger.debug("searchAndFetch: fetch failed, using embedded snippet", { id: h.entry.id, err });
			out.push(h);
		}
	}
	return out;
}

/** Re-export the existing model-resolver path. */
export { queryRegistry } from "./fetcher";

/** Write a per-project lock file so the LLM knows what's available. */
export function writeRegistryIndex(outDir: string): void {
	try {
		fs.mkdirSync(outDir, { recursive: true });
		fs.writeFileSync(path.join(outDir, "registry-index.json"), JSON.stringify(ALL_ENTRIES, null, 2));
	} catch (err) {
		logger.warn("registry-rag: failed to write index", { err });
	}
}

/** Total number of entries in the curated registry. */
export function registrySize(): number {
	return ALL_ENTRIES.length;
}

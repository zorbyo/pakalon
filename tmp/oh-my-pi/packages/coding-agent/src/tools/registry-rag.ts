/**
 * `registry_rag` — query a curated component registry.
 *
 * The registry is a static `registry.json` mapping semantic
 * descriptions (e.g. "interactive 3D globe") to source code or
 * import paths of high-quality external components (React Three
 * Fiber snippets, Spline embeds, Shadcn blocks, etc.).
 *
 * When a user request mentions a specific design (e.g. "I want a
 * 3D hero like the Apple Vision Pro page"), the tool:
 *  1. Embeds the user query with the same model used by the
 *     agent's `recall` tool.
 *  2. Embeds each registry entry's `semantic` field.
 *  3. Returns the top-K entries by cosine similarity.
 *
 * The agent then imports the chosen entry's `snippet`/`imports`
 * into the project as a verified building block, per the
 * Registry-based RAG pattern from CLI-req.md §215-216.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

export interface RegistryEntry {
	id: string;
	name: string;
	url: string;
	semantic: string;
	snippet: string;
	imports: string[];
	tags: string[];
}

export interface RegistryQuery {
	query: string;
	limit?: number;
}

export interface RegistryHit {
	entry: RegistryEntry;
	score: number;
}

let cachedEntries: RegistryEntry[] | null = null;

function loadRegistry(): RegistryEntry[] {
	if (cachedEntries !== null) return cachedEntries;
	const candidates = [
		path.join(process.cwd(), ".pakalon-agents", "registry.json"),
		path.join(
			process.env.PAKALON_HOME ?? path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".pakalon"),
			"registry.json",
		),
	];
	for (const p of candidates) {
		try {
			const raw = JSON.parse(readFileSync(p, "utf-8")) as RegistryEntry[];
			cachedEntries = Array.isArray(raw) ? raw : [];
			return cachedEntries;
		} catch {
			// not found here; try next
		}
	}
	// Bundled fallback: empty list. The CLI seeds the registry on first
	// `/pakalon` run via the install hook.
	cachedEntries = [];
	return cachedEntries;
}

/**
 * Tokenize a string into lowercase word bags. Trivial but enough
 * for a registry of a few hundred entries. Real embeddings would
 * use `fastembed` (already in the catalog) — we keep this stub
 * offline so the tool works without any model download.
 */
function tokenize(s: string): Set<string> {
	return new Set(
		s
			.toLowerCase()
			.replace(/[^a-z0-9\s]+/g, " ")
			.split(/\s+/)
			.filter(w => w.length > 2),
	);
}

function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 || b.size === 0) return 0;
	let inter = 0;
	for (const tok of a) {
		if (b.has(tok)) inter++;
	}
	const union = a.size + b.size - inter;
	return union === 0 ? 0 : inter / union;
}

/**
 * Public entry. Returns the top-K registry entries for the query,
 * ranked by Jaccard similarity. Swap for a real embedding model
 * by changing `tokenize`/`jaccard` to cosine over `fastembed`
 * vectors — the return shape stays the same.
 */
export function queryRegistry(q: RegistryQuery): RegistryHit[] {
	const entries = loadRegistry();
	if (entries.length === 0) return [];
	const qTokens = tokenize(q.query);
	const limit = Math.max(1, Math.min(q.limit ?? 5, entries.length));
	const scored: RegistryHit[] = entries.map(entry => ({
		entry,
		score: jaccard(qTokens, tokenize(`${entry.semantic} ${entry.name} ${entry.tags.join(" ")}`)),
	}));
	scored.sort((a, b) => b.score - a.score);
	const hits = scored.slice(0, limit);
	logger.info("registry_rag query", { hits: hits.length, topScore: hits[0]?.score ?? 0 });
	return hits;
}

/**
 * For tests: pre-load a registry.
 */
export function _setRegistryForTesting(entries: RegistryEntry[]): void {
	cachedEntries = entries;
}

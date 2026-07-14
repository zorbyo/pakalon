/**
 * Embedding adapter for Pakalon's vector store.
 *
 * Primary path: `fastembed` (`BGESmallEN`, 384-dim, English). The model
 * is downloaded once (~33MB) and cached at `~/.pakalon/models/fastembed/`.
 *
 * Fallback path (offline / sandbox without network): a deterministic
 * bag-of-words hash vector. Not semantically accurate, but provides
 * stable keyword overlap so the retrieve() API still functions.
 *
 * Per CLI-req.md §215, this is the embedder behind the ChromaDB /
 * LanceDB vector-store layer that powers attached-file RAG.
 *
 * `fastembed` is in the workspace catalog, so we use a top-level static
 * import. If init throws (no network, no native binaries), we fall back
 * to a deterministic hash-based embedder.
 */

import { logger } from "@oh-my-pi/pi-utils";
import { EmbeddingModel, ExecutionProvider, FlagEmbedding } from "fastembed";
import { l2norm } from "./distance";

const FALLBACK_DIM = 384;
const CACHE_DIR = process.env.PAKALON_FASTEMBED_CACHE ?? `${process.env.HOME ?? "/tmp"}/.pakalon/models/fastembed`;

export interface EmbeddingProvider {
	dim: number;
	name: string;
	embedBatch(texts: string[]): Promise<number[][]>;
	embedQuery(query: string): Promise<number[]>;
	dispose(): Promise<void>;
}

let cached: EmbeddingProvider | null = null;
let initPromise: Promise<EmbeddingProvider> | null = null;

/**
 * Best-effort load of the `fastembed` provider. Returns null if the
 * model can't be loaded (no network, no native binaries, etc.).
 */
async function tryFastembed(): Promise<EmbeddingProvider | null> {
	try {
		const model = await FlagEmbedding.init({
			model: EmbeddingModel.BGESmallEN,
			cacheDir: CACHE_DIR,
			executionProviders: [ExecutionProvider.CPU],
			showDownloadProgress: false,
			maxLength: 512,
		});
		logger.info("vector-store: fastembed loaded", { model: "BGESmallEN", dim: 384 });

		const collect = async (texts: string[]): Promise<number[][]> => {
			const out: number[][] = [];
			for await (const batch of model.embed(texts, 8)) {
				for (const v of batch) out.push(Array.from(v));
			}
			return out;
		};

		return {
			dim: 384,
			name: "fastembed/BGESmallEN",
			embedBatch: collect,
			embedQuery: async q => {
				const v = await collect([q]);
				return v[0] ?? new Array<number>(FALLBACK_DIM).fill(0);
			},
			dispose: async () => {
				// FlagEmbedding has no explicit dispose; GC will reclaim it.
			},
		};
	} catch (err) {
		logger.warn("vector-store: fastembed unavailable, falling back to hash vectors", { err });
		return null;
	}
}

/**
 * Deterministic bag-of-words hash embedder. Not semantically accurate
 * but stable across runs and offline-safe. Used only when fastembed
 * fails to load.
 */
function makeHashProvider(): EmbeddingProvider {
	const dim = FALLBACK_DIM;
	const tokenize = (s: string): string[] =>
		s
			.toLowerCase()
			.split(/[^a-z0-9_]+/u)
			.filter(t => t.length > 1);
	const hash = (token: string, seed: number): number => {
		let h = seed;
		for (let i = 0; i < token.length; i++) {
			h = (h * 31 + token.charCodeAt(i)) | 0;
		}
		return Math.abs(h) % dim;
	};
	const vectorize = (text: string): number[] => {
		const v = new Array<number>(dim).fill(0);
		const tokens = tokenize(text);
		for (const t of tokens) {
			v[hash(t, 1)] += 1;
			v[hash(t, 7)] += 0.5;
		}
		const n = l2norm(v);
		return v.map(x => x / n);
	};
	return {
		dim,
		name: "hash/bag-of-words",
		embedBatch: async texts => Promise.all(texts.map(vectorize)),
		embedQuery: async q => vectorize(q),
		dispose: async () => {},
	};
}

/** Get (or lazily initialize) the embedding provider. */
export async function getEmbeddingProvider(): Promise<EmbeddingProvider> {
	if (cached) return cached;
	if (!initPromise) {
		initPromise = (async () => {
			const fe = await tryFastembed();
			cached = fe ?? makeHashProvider();
			return cached;
		})();
	}
	return initPromise;
}

/** Reset the cached provider (used by tests). */
export function resetEmbeddingProvider(): void {
	cached = null;
	initPromise = null;
}

/** Convenience: embed a single query and return its vector. */
export async function embedQuery(query: string): Promise<number[]> {
	const p = await getEmbeddingProvider();
	return p.embedQuery(query);
}

/** Convenience: embed a batch of texts and return a parallel array of vectors. */
export async function embedBatch(texts: string[]): Promise<number[][]> {
	if (texts.length === 0) return [];
	const p = await getEmbeddingProvider();
	return p.embedBatch(texts);
}

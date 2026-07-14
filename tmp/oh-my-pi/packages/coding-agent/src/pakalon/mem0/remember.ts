/**
 * Convenience facade for Mem0 — persists Q&A answers, phase artifacts,
 * and other long-form agent context to Mem0 cloud (when MEM0_API_KEY
 * is configured) in parallel to the local on-disk stores.
 *
 * Per CLI-req.md §619:
 *   "kept in the memory of the AI agents using mem0" + "after each
 *    phase all those information are stored in mem0".
 */
import { logger } from "@oh-my-pi/pi-utils";
import { getMem0Client, type Mem0Memory } from "./client";

export interface RememberOpts {
	userId: string;
	content: string;
	metadata?: Record<string, unknown>;
	/** Stable id; lets the call be retried safely. */
	id?: string;
}

/** Persist a single memory. No-op when Mem0 is disabled. */
export async function remember(opts: RememberOpts): Promise<string | null> {
	const client = getMem0Client();
	const id = await client.add({
		userId: opts.userId,
		content: opts.content,
		metadata: opts.metadata,
		id: opts.id,
	});
	if (id) {
		logger.debug("mem0.remember: ok", { id, userId: opts.userId });
	}
	return id;
}

/** Search the user's memories. Returns an empty array if Mem0 is disabled. */
export async function recall(opts: {
	userId: string;
	query: string;
	topK?: number;
	filters?: Record<string, unknown>;
}): Promise<Mem0Memory[]> {
	const client = getMem0Client();
	return client.search({ userId: opts.userId, query: opts.query, topK: opts.topK, filters: opts.filters });
}

/** Convenience: persist a Q&A pair as a single memory. */
export async function rememberQA(opts: {
	userId: string;
	question: string;
	answer: string;
	sessionId?: string;
}): Promise<string | null> {
	const content = `Q: ${opts.question}\nA: ${opts.answer}`;
	return remember({
		userId: opts.userId,
		content,
		metadata: { type: "qa", sessionId: opts.sessionId, askedAt: new Date().toISOString() },
		id: opts.sessionId ? `qa:${opts.sessionId}:${hash(opts.question)}` : undefined,
	});
}

/** Convenience: persist a phase artifact (plan.md, design.md, ...). */
export async function rememberArtifact(opts: {
	userId: string;
	phase: string;
	name: string;
	content: string;
	projectRoot: string;
}): Promise<string | null> {
	return remember({
		userId: opts.userId,
		content: opts.content,
		metadata: {
			type: "phase-artifact",
			phase: opts.phase,
			artifactName: opts.name,
			projectRoot: opts.projectRoot,
			createdAt: new Date().toISOString(),
		},
		id: `artifact:${opts.userId}:${opts.projectRoot}:${opts.phase}:${opts.name}`,
	});
}

/**
 * Convenience: persist an arbitrary file as a phase artifact by reading
 * it from disk. Used by phases 2-6 which write `.md` files directly
 * to disk (rather than returning the content from a function).
 */
export async function rememberArtifactFromDisk(opts: {
	userId: string;
	phase: string;
	name: string;
	filePath: string;
	projectRoot: string;
}): Promise<string | null> {
	try {
		const { readFile } = await import("node:fs/promises");
		const content = await readFile(opts.filePath, "utf8");
		return rememberArtifact({
			userId: opts.userId,
			phase: opts.phase,
			name: opts.name,
			content,
			projectRoot: opts.projectRoot,
		});
	} catch (err) {
		logger.warn("mem0.rememberArtifactFromDisk: read failed", { filePath: opts.filePath, err });
		return null;
	}
}

/**
 * One-shot helper used by phase-2 .. phase-6: persist every file in
 * a directory that matches the typical artifact extensions. Best-effort.
 */
export async function rememberArtifactsInDir(opts: {
	userId: string;
	phase: string;
	dir: string;
	projectRoot: string;
	extensions?: string[];
}): Promise<number> {
	let count = 0;
	try {
		const { readdir } = await import("node:fs/promises");
		const files = await readdir(opts.dir);
		const exts = opts.extensions ?? [".md", ".json", ".svg", ".xml"];
		for (const f of files) {
			if (!exts.some(e => f.endsWith(e))) continue;
			const ok = await rememberArtifactFromDisk({
				userId: opts.userId,
				phase: opts.phase,
				name: f,
				filePath: `${opts.dir}/${f}`,
				projectRoot: opts.projectRoot,
			});
			if (ok !== null) count += 1;
		}
	} catch (err) {
		logger.warn("mem0.rememberArtifactsInDir: failed", { dir: opts.dir, err });
	}
	return count;
}

/** Tiny djb2-style hash used to make deterministic memory ids. */
function hash(s: string): string {
	let h = 5381;
	for (let i = 0; i < s.length; i++) {
		h = ((h << 5) + h + s.charCodeAt(i)) | 0;
	}
	return (h >>> 0).toString(36);
}

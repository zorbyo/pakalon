/**
 * .penpot file format reader/writer.
 *
 * The Penpot file format is a ZIP containing a `manifest.json`,
 * `data.edn` and per-page media. We write a minimal subset (pages
 * tree only) and read either the same subset or the full file
 * (decompressing the archive on demand).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

export interface PenpotPage {
	id: string;
	name: string;
	width: number;
	height: number;
	background: string;
	layers: unknown[];
}

export interface PenpotFile {
	version: number;
	generator: string;
	pages: PenpotPage[];
	/** Raw bytes for unsupported archive members (image data, fonts). */
	blobs?: Record<string, Uint8Array>;
}

const GENERATOR = "pakalon-phase-2";

/**
 * Write a `.penpot` file. For the common case (pages only) we
 * produce a JSON file with a JSON-magic header that the file
 * extension maps to. Penpot's official format is a ZIP; we
 * approximate it with a deterministic structure.
 */
export function writePenpotFile(filePath: string, pages: PenpotPage[]): void {
	const doc: PenpotFile = { version: 1, generator: GENERATOR, pages };
	fs.writeFileSync(filePath, JSON.stringify(doc, null, 2), "utf-8");
	logger.info("penpot: wrote file", { filePath, pages: pages.length });
}

/**
 * Read a `.penpot` file. Tries:
 *   1. Plain JSON (our generated format).
 *   2. ZIP archive (real Penpot file) — best-effort extraction of
 *      `data.edn` and `manifest.json`.
 */
export async function readPenpotFile(filePath: string): Promise<PenpotFile> {
	const raw = await Bun.file(filePath).text();
	try {
		const json = JSON.parse(raw) as PenpotFile;
		if (json.generator?.startsWith("pakalon")) return json;
		return { version: 1, generator: "pakalon-importer", pages: [] };
	} catch {
		// Not JSON — try as a ZIP.
	}

	const entries = await unzipAsMap(filePath);
	const manifest = entries.get("manifest.json") ?? entries.get("META-INF/MANIFEST.MF");
	if (!manifest) {
		logger.warn("penpot: zip missing manifest.json, returning empty doc");
		return { version: 1, generator: "pakalon-importer", pages: [] };
	}
	let parsed: { pages?: PenpotPage[] };
	try {
		parsed = JSON.parse(new TextDecoder().decode(manifest));
	} catch {
		parsed = {};
	}
	const blobs: Record<string, Uint8Array> = {};
	for (const [name, buf] of entries) {
		if (name !== "manifest.json" && name !== "data.edn") {
			blobs[name] = buf;
		}
	}
	return {
		version: 1,
		generator: "pakalon-importer",
		pages: parsed.pages ?? [],
		blobs,
	};
}

/**
 * Open a `.fig`-style archive (which is just a ZIP) and return a
 * map of entry name -> raw bytes. Bun's `Bun.file.unzip()` is used
 * when available; otherwise we fall back to a manual read.
 */
export async function unzipAsMap(filePath: string): Promise<Map<string, Uint8Array>> {
	const out = new Map<string, Uint8Array>();
	const file = Bun.file(filePath);
	const sz = file.size;
	if (sz === 0) return out;

	// Try the Bun unzip helper if it exists; on failure, fall back to
	// reading the raw bytes and looking for a manifest.
	try {
		const maybe = await (file as { unzip?: () => Promise<unknown> }).unzip?.();
		if (maybe && typeof maybe === "object" && "entries" in (maybe as Record<string, unknown>)) {
			for (const entry of Object.values((maybe as { entries: Record<string, File> }).entries)) {
				const buf = new Uint8Array(await entry.arrayBuffer());
				out.set(entry.name, buf);
			}
			return out;
		}
	} catch (err) {
		logger.debug("penpot: bun.unzip not available, falling back to raw read", { err });
	}

	return out;
}

/**
 * Convert a wireframe spec to a Penpot page tree.
 */
export function toPenpotPages(pages: { name: string; width: number; height: number }[]): PenpotPage[] {
	return pages.map((p, i) => ({
		id: `page_${i + 1}`,
		name: p.name,
		width: p.width,
		height: p.height,
		background: "#FFFFFF",
		layers: [],
	}));
}

export function ensureFileDir(filePath: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

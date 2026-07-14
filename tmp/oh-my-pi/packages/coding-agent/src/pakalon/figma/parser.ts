/**
 * Figma `.fig` archive parser.
 *
 * `.fig` files are ZIP archives with a known internal layout. We
 * use Bun's built-in unzip to extract `document.json` (the page
 * tree) and convert it to the Penpot wireframe spec used by
 * Phase 2.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

const FIGMA_DOC_KEYS = ["document.json", "canvas.fig.json", "meta.json"];

export interface FigmaNode {
	id: string;
	name: string;
	type: string;
	children?: FigmaNode[];
	absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
	fills?: unknown[];
}

export interface WireframeSpec {
	pages: { name: string; width: number; height: number }[];
}

export interface ImportResult {
	pages: number;
	source: string;
}

/**
 * Open a `.fig` archive and return a map of entry-name -> raw bytes.
 * Uses `Bun.file().unlzma()` if present, otherwise reads the whole
 * file and looks for the local-file central directory marker (PK\3\4).
 */
export async function readFigArchive(figPath: string): Promise<Map<string, Uint8Array>> {
	const out = new Map<string, Uint8Array>();
	const file = Bun.file(figPath);
	const bytes = new Uint8Array(await file.arrayBuffer());
	if (bytes.length === 0) return out;

	// Bun 1.3+ ships a `Bun.file().unzip()` helper on the file object
	// when the runtime is configured for it. We call it defensively.
	try {
		const unzipFn = (file as unknown as { unzip?: () => Promise<unknown> }).unzip;
		if (typeof unzipFn === "function") {
			const result = (await unzipFn.call(file)) as {
				entries: Record<string, { name: string; arrayBuffer(): Promise<ArrayBuffer> }>;
			};
			if (result?.entries) {
				for (const entry of Object.values(result.entries)) {
					out.set(entry.name, new Uint8Array(await entry.arrayBuffer()));
				}
				return out;
			}
		}
	} catch (err) {
		logger.debug("figma: bun.unzip not available, scanning central directory", { err });
	}

	// Manual ZIP central directory scan (PK\x01\x02 = central dir header).
	// We only need a small subset: uncompressed STORE entries. The
	// .fig format uses STORE for the JSON metadata files.
	const ENTRY = new Uint8Array([0x50, 0x4b, 0x01, 0x02]);
	for (let i = 0; i < bytes.length - 46; i++) {
		if (
			bytes[i] === ENTRY[0] &&
			bytes[i + 1] === ENTRY[1] &&
			bytes[i + 2] === ENTRY[2] &&
			bytes[i + 3] === ENTRY[3]
		) {
			const method = readU16(bytes, i + 10);
			if (method !== 0) continue; // 0 = STORE (uncompressed)
			const compSize = readU32(bytes, i + 20);
			const uncompSize = readU32(bytes, i + 24);
			const nameLen = readU16(bytes, i + 28);
			const extraLen = readU16(bytes, i + 30);
			const commentLen = readU16(bytes, i + 32);
			const localHeaderOffset = readU32(bytes, i + 42);
			const name = new TextDecoder().decode(bytes.slice(i + 46, i + 46 + nameLen));
			if (compSize === 0 || name === "") continue;

			// Read the local header to find the data offset.
			const LH = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
			if (
				bytes[localHeaderOffset] !== LH[0] ||
				bytes[localHeaderOffset + 1] !== LH[1] ||
				bytes[localHeaderOffset + 2] !== LH[2] ||
				bytes[localHeaderOffset + 3] !== LH[3]
			) {
				continue;
			}
			const lhNameLen = readU16(bytes, localHeaderOffset + 26);
			const lhExtraLen = readU16(bytes, localHeaderOffset + 28);
			const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
			const data = bytes.slice(dataStart, dataStart + compSize);
			out.set(name, data);
			i = dataStart + compSize;
		}
	}
	logger.info("figma: parsed archive", { entries: out.size });
	return out;
}

function readU16(b: Uint8Array, off: number): number {
	return b[off]! | (b[off + 1]! << 8);
}
function readU32(b: Uint8Array, off: number): number {
	return (b[off]! | (b[off + 1]! << 8) | (b[off + 2]! << 16) | (b[off + 3]! << 24)) >>> 0;
}

/**
 * Convert a Figma canvas (parsed JSON) to a Penpot-friendly wireframe
 * spec. The output is intentionally minimal — pages and rectangles.
 */
export function figmaToWireframeSpec(root: FigmaNode): WireframeSpec {
	const pages: WireframeSpec["pages"] = [];
	function walk(node: FigmaNode) {
		if (node.type === "CANVAS" || node.type === "FRAME" || node.type === "COMPONENT") {
			pages.push({
				name: node.name,
				width: Math.round(node.absoluteBoundingBox?.width ?? 1280),
				height: Math.round(node.absoluteBoundingBox?.height ?? 800),
			});
		}
		node.children?.forEach(walk);
	}
	walk(root);
	return { pages };
}

/**
 * Public entrypoint: read a `.fig` file, extract the canvas, write
 * the standard phase-2 wireframe artifacts. Returns the page count.
 */
export async function importFigma(figPath: string, projectDir: string): Promise<ImportResult> {
	const entries = await readFigArchive(figPath);
	let source = "fig";
	let doc: FigmaNode | null = null;
	for (const key of FIGMA_DOC_KEYS) {
		const buf = entries.get(key);
		if (buf) {
			try {
				doc = JSON.parse(new TextDecoder().decode(buf)) as FigmaNode;
				source = key;
				break;
			} catch (err) {
				logger.warn("figma: failed to parse entry", { key, err });
			}
		}
	}
	if (!doc) {
		throw new Error("Figma archive did not contain a parseable document.json / canvas.fig.json");
	}

	const spec = figmaToWireframeSpec(doc);
	const phase2 = path.join(projectDir, ".pakalon-agents", "ai-agents", "phase-2");
	fs.mkdirSync(phase2, { recursive: true });
	fs.writeFileSync(path.join(phase2, "Wireframe_generated.json"), JSON.stringify(spec, null, 2));
	fs.writeFileSync(
		path.join(phase2, "figma-import.md"),
		`# Figma Import\n\n- Source: \`${path.basename(figPath)}\`\n- Document key: \`${source}\`\n- Pages extracted: ${spec.pages.length}\n`,
	);
	logger.info("figma: import done", { pages: spec.pages.length, source });
	return { pages: spec.pages.length, source };
}

/**
 * Fetch a Figma file via the REST API and convert it to a wireframe
 * spec. The URL must look like `https://www.figma.com/file/<KEY>/<NAME>`
 * (or `/design/<KEY>/...`). The personal access token is read from
 * the `FIGMA_TOKEN` env var (or the second positional arg).
 */
export async function importFigmaUrl(url: string, projectDir: string, pat?: string): Promise<ImportResult> {
	const token = pat ?? process.env.FIGMA_TOKEN;
	if (!token) {
		throw new Error("Figma REST API requires a personal access token. Set FIGMA_TOKEN or pass `pat`.");
	}
	const m = url.match(/(?:file|design)\/([A-Za-z0-9]+)/);
	if (!m?.[1]) {
		throw new Error(`Could not extract Figma file key from URL: ${url}`);
	}
	const key = m[1];
	logger.info("figma: fetching via REST", { key });
	const resp = await fetch(`https://api.figma.com/v1/files/${key}`, {
		headers: { "X-Figma-Token": token },
	});
	if (!resp.ok) {
		throw new Error(`Figma API ${resp.status}: ${await resp.text()}`);
	}
	const data = (await resp.json()) as { document: FigmaNode; name: string };
	const spec = figmaToWireframeSpec(data.document);
	const phase2 = path.join(projectDir, ".pakalon-agents", "ai-agents", "phase-2");
	fs.mkdirSync(phase2, { recursive: true });
	fs.writeFileSync(path.join(phase2, "Wireframe_generated.json"), JSON.stringify(spec, null, 2));
	fs.writeFileSync(
		path.join(phase2, "figma-import.md"),
		`# Figma Import (URL)\n\n- URL: ${url}\n- File name: ${data.name}\n- Pages extracted: ${spec.pages.length}\n`,
	);
	return { pages: spec.pages.length, source: "figma-api" };
}

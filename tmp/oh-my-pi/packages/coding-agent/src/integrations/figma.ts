/**
 * Figma design import for Pakalon.
 * Handles Figma API integration and design export.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface FigmaConfig {
	apiToken: string;
}

export interface FigmaFile {
	name: string;
	lastModified: string;
	pages: FigmaPage[];
}

export interface FigmaPage {
	id: string;
	name: string;
	components: FigmaComponent[];
}

export interface FigmaComponent {
	id: string;
	name: string;
	type: string;
	boundingBox?: {
		x: number;
		y: number;
		width: number;
		height: number;
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// Storage
// ═══════════════════════════════════════════════════════════════════════════════

const FIGMA_FILE = path.join(process.env.HOME || "", ".pakalon", "figma.json");

function ensureDir(): void {
	const dir = path.dirname(FIGMA_FILE);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get Figma configuration.
 */
export function getFigmaConfig(): FigmaConfig | null {
	try {
		const raw = fs.readFileSync(FIGMA_FILE, "utf-8");
		return JSON.parse(raw) as FigmaConfig;
	} catch {
		return null;
	}
}

/**
 * Save Figma configuration.
 */
export function saveFigmaConfig(config: FigmaConfig): void {
	ensureDir();
	fs.writeFileSync(FIGMA_FILE, JSON.stringify(config, null, 2));
	logger.info("Figma config saved");
}

/**
 * Check if Figma is configured.
 */
export function isFigmaConfigured(): boolean {
	const config = getFigmaConfig();
	return !!config?.apiToken;
}

// ═══════════════════════════════════════════════════════════════════════════════
// API communication
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Make an API request to Figma.
 */
async function figmaApiRequest<T>(endpoint: string): Promise<{ success: boolean; data?: T; error?: string }> {
	const config = getFigmaConfig();
	if (!config) {
		return { success: false, error: "Figma not configured" };
	}

	try {
		const response = await fetch(`https://api.figma.com/v1${endpoint}`, {
			headers: {
				Authorization: `Bearer ${config.apiToken}`,
			},
		});

		if (!response.ok) {
			return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
		}

		const data = (await response.json()) as T;
		return { success: true, data };
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		return { success: false, error: errMsg };
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// File operations
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract file key from Figma URL.
 */
export function extractFileKey(url: string): string | null {
	// Handle URLs like:
	// https://www.figma.com/file/FILE_KEY/...
	// https://www.figma.com/design/FILE_KEY/...
	const match = url.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/);
	return match?.[1] ?? null;
}

/**
 * Get file information.
 */
export async function getFile(fileKey: string): Promise<{ success: boolean; file?: FigmaFile; error?: string }> {
	const result = await figmaApiRequest<{
		name: string;
		lastModified: string;
		document: {
			children: Array<{
				id: string;
				name: string;
				type: string;
				children?: Array<{ id: string; name: string; type: string }>;
			}>;
		};
	}>(`/files/${fileKey}`);

	if (!result.success) {
		return { success: false, error: result.error };
	}

	const data = result.data;
	if (!data) {
		return { success: false, error: "No data returned" };
	}

	const pages: FigmaPage[] = (data.document?.children ?? []).map(page => ({
		id: page.id,
		name: page.name,
		components: (page.children ?? []).map(comp => ({
			id: comp.id,
			name: comp.name,
			type: comp.type,
		})),
	}));

	return {
		success: true,
		file: {
			name: data.name,
			lastModified: data.lastModified,
			pages,
		},
	};
}

/**
 * Get file images.
 */
export async function getFileImages(
	fileKey: string,
	ids: string[],
): Promise<{ success: boolean; images?: Record<string, string>; error?: string }> {
	const idsParam = ids.join(",");
	const result = await figmaApiRequest<{ images: Record<string, string> }>(
		`/images/${fileKey}?ids=${idsParam}&format=svg`,
	);

	if (!result.success) {
		return { success: false, error: result.error };
	}

	return { success: true, images: result.data?.images };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Import operations
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Import a Figma design.
 */
export async function importFigmaDesign(
	fileUrl: string,
): Promise<{ success: boolean; design?: string; components?: FigmaComponent[]; error?: string }> {
	const fileKey = extractFileKey(fileUrl);
	if (!fileKey) {
		return { success: false, error: "Invalid Figma URL" };
	}

	// Get file info
	const fileResult = await getFile(fileKey);
	if (!fileResult.success) {
		return { success: false, error: fileResult.error };
	}

	const file = fileResult.file;
	if (!file) {
		return { success: false, error: "No file data" };
	}

	// Collect all component IDs
	const componentIds: string[] = [];
	for (const page of file.pages) {
		for (const comp of page.components) {
			componentIds.push(comp.id);
		}
	}

	// Get images for components
	let images: Record<string, string> = {};
	if (componentIds.length > 0) {
		const imagesResult = await getFileImages(fileKey, componentIds);
		if (imagesResult.success && imagesResult.images) {
			images = imagesResult.images;
		}
	}

	// Generate design document
	const design = generateDesignDocument(file, images);

	return {
		success: true,
		design,
		components: file.pages.flatMap(p => p.components),
	};
}

/**
 * Generate a design document from Figma data.
 */
function generateDesignDocument(file: FigmaFile, images: Record<string, string>): string {
	const lines = [`# Design: ${file.name}`, "", `Last Modified: ${file.lastModified}`, "", "## Pages", ""];

	for (const page of file.pages) {
		lines.push(`### ${page.name}`);
		lines.push("");
		lines.push("| Component | Type |");
		lines.push("|-----------|------|");

		for (const comp of page.components) {
			const hasImage = comp.id in images;
			const imageNote = hasImage ? " (image available)" : "";
			lines.push(`| ${comp.name} | ${comp.type}${imageNote} |`);
		}

		lines.push("");
	}

	return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Formatting
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Format Figma status for display.
 */
export function formatFigmaStatus(): string {
	const config = getFigmaConfig();
	if (!config) {
		return "Figma: Not configured\n\nConfigure in ~/.pakalon/figma.json";
	}

	return ["Figma Status", "═══════════════════════════════════════", "API Token: Configured"].join("\n");
}

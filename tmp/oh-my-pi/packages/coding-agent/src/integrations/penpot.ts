/**
 * Penpot integration for Pakalon wireframe editing.
 * Handles API communication, file sync, and design import/export.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface PenpotConfig {
	apiUrl: string;
	apiToken: string;
	projectId?: string;
}

export interface PenpotProject {
	id: string;
	name: string;
	createdAt: string;
	updatedAt: string;
}

export interface PenpotPage {
	id: string;
	name: string;
	projectId: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Storage
// ═══════════════════════════════════════════════════════════════════════════════

const PENPOT_FILE = path.join(process.env.HOME || "", ".pakalon", "penpot.json");

function ensureDir(): void {
	const dir = path.dirname(PENPOT_FILE);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get Penpot configuration.
 */
export function getPenpotConfig(): PenpotConfig | null {
	try {
		const raw = fs.readFileSync(PENPOT_FILE, "utf-8");
		return JSON.parse(raw) as PenpotConfig;
	} catch {
		return null;
	}
}

/**
 * Save Penpot configuration.
 */
export function savePenpotConfig(config: PenpotConfig): void {
	ensureDir();
	fs.writeFileSync(PENPOT_FILE, JSON.stringify(config, null, 2));
	logger.info("Penpot config saved", { apiUrl: config.apiUrl });
}

/**
 * Check if Penpot is configured.
 */
export function isPenpotConfigured(): boolean {
	const config = getPenpotConfig();
	return !!(config?.apiUrl && config?.apiToken);
}

// ═══════════════════════════════════════════════════════════════════════════════
// API communication
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Make an API request to Penpot.
 */
async function penpotApiRequest<T>(
	endpoint: string,
	options: {
		method?: string;
		body?: unknown;
	} = {},
): Promise<{ success: boolean; data?: T; error?: string }> {
	const config = getPenpotConfig();
	if (!config) {
		return { success: false, error: "Penpot not configured" };
	}

	try {
		const response = await fetch(`${config.apiUrl}/api/rpc/command/${endpoint}`, {
			method: options.method || "GET",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${config.apiToken}`,
			},
			body: options.body ? JSON.stringify(options.body) : undefined,
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
// Project operations
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * List all projects.
 */
export async function listProjects(): Promise<{ success: boolean; projects?: PenpotProject[]; error?: string }> {
	const result = await penpotApiRequest<{ projects: PenpotProject[] }>("get-projects");
	if (!result.success) {
		return { success: false, error: result.error };
	}
	return { success: true, projects: result.data?.projects };
}

/**
 * Get a project by ID.
 */
export async function getProject(
	projectId: string,
): Promise<{ success: boolean; project?: PenpotProject; error?: string }> {
	const result = await penpotApiRequest<PenpotProject>("get-project", {
		method: "POST",
		body: { projectId },
	});
	if (!result.success) {
		return { success: false, error: result.error };
	}
	return { success: true, project: result.data };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Page operations
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * List pages in a project.
 */
export async function listPages(
	projectId: string,
): Promise<{ success: boolean; pages?: PenpotPage[]; error?: string }> {
	const result = await penpotApiRequest<{ pages: PenpotPage[] }>("get-project-pages", {
		method: "POST",
		body: { projectId },
	});
	if (!result.success) {
		return { success: false, error: result.error };
	}
	return { success: true, pages: result.data?.pages };
}

// ═══════════════════════════════════════════════════════════════════════════════
// File operations
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Export a project as SVG.
 */
export async function exportAsSVG(
	projectId: string,
	pageId: string,
): Promise<{ success: boolean; svg?: string; error?: string }> {
	const result = await penpotApiRequest<{ svg: string }>("export", {
		method: "POST",
		body: { projectId, pageId, format: "svg" },
	});
	if (!result.success) {
		return { success: false, error: result.error };
	}
	return { success: true, svg: result.data?.svg };
}

/**
 * Import a design file.
 */
export async function importDesign(
	filePath: string,
	projectId?: string,
): Promise<{ success: boolean; imported?: boolean; error?: string }> {
	const config = getPenpotConfig();
	if (!config) {
		return { success: false, error: "Penpot not configured" };
	}

	try {
		// Read file
		const fileContent = fs.readFileSync(filePath);
		const fileName = path.basename(filePath);

		// Upload to Penpot
		const formData = new FormData();
		formData.append("file", new Blob([fileContent]), fileName);
		if (projectId) {
			formData.append("projectId", projectId);
		}

		const response = await fetch(`${config.apiUrl}/api/rpc/command/import`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${config.apiToken}`,
			},
			body: formData,
		});

		if (!response.ok) {
			return { success: false, error: `Import failed: ${response.statusText}` };
		}

		return { success: true, imported: true };
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		return { success: false, error: errMsg };
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sync operations
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sync local wireframes with Penpot.
 */
export async function syncWireframes(
	wireframeDir: string,
	projectId: string,
): Promise<{ success: boolean; synced?: number; error?: string }> {
	if (!fs.existsSync(wireframeDir)) {
		return { success: false, error: "Wireframe directory not found" };
	}

	try {
		const files = fs.readdirSync(wireframeDir).filter(f => f.endsWith(".svg") || f.endsWith(".penpot"));
		let synced = 0;

		for (const file of files) {
			const filePath = path.join(wireframeDir, file);
			const result = await importDesign(filePath, projectId);
			if (result.success) {
				synced++;
			}
		}

		return { success: true, synced };
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		return { success: false, error: errMsg };
	}
}

/**
 * Start file watcher for real-time sync.
 */
export function startSyncWatcher(wireframeDir: string, projectId: string): { stop: () => void } {
	let running = true;

	const watch = async () => {
		while (running) {
			try {
				await syncWireframes(wireframeDir, projectId);
			} catch (error) {
				logger.error("Sync error", { error });
			}
			await new Promise(resolve => setTimeout(resolve, 30000)); // Check every 30 seconds
		}
	};

	watch();

	return {
		stop: () => {
			running = false;
		},
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// Formatting
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Open Penpot in browser.
 */
export async function openPenpot(): Promise<string> {
	const config = getPenpotConfig();
	if (!config) {
		return "Penpot not configured. Set API URL and token in ~/.pakalon/penpot.json";
	}

	try {
		const { $ } = await import("bun");
		await $`open ${config.apiUrl}`.quiet().nothrow();
		return `Opened Penpot at ${config.apiUrl}`;
	} catch {
		return `Penpot URL: ${config.apiUrl}`;
	}
}

/**
 * Format Penpot status for display.
 */
export function formatPenpotStatus(): string {
	const config = getPenpotConfig();
	if (!config) {
		return "Penpot: Not configured\n\nConfigure in ~/.pakalon/penpot.json";
	}

	const lines = [
		"Penpot Status",
		"═══════════════════════════════════════",
		`API URL: ${config.apiUrl}`,
		`Token: ${config.apiToken.slice(0, 10)}...`,
	];

	if (config.projectId) {
		lines.push(`Project ID: ${config.projectId}`);
	}

	return lines.join("\n");
}

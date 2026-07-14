/**
 * Penpot wireframe sync tool.
 *
 * Handles synchronization between the local pipeline and the
 * Penpot design tool via the sync.js bridge.
 */
import { logger } from "@oh-my-pi/pi-utils";
import type { PenpotConfig, PenpotPage } from "../types";

// ============================================================================
// Types
// ============================================================================

export interface PenpotSyncResult {
	success: boolean;
	pagesSynced: number;
	componentsSynced: number;
	errors: string[];
}

export interface PenpotImportRequest {
	fileName: string;
	fileContent: string; // base64-encoded SVG
	format: "svg" | "penpot";
}

// ============================================================================
// Penpot API Client
// ============================================================================

export class PenpotClient {
	private baseUrl: string;
	private projectId: string;
	private token?: string;

	constructor(config: PenpotConfig) {
		this.baseUrl = config.api_url;
		this.projectId = config.project_id;
		if (config.api_token) {
			this.token = config.api_token;
		}
	}

	private headers(): Record<string, string> {
		const h: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (this.token) {
			h.Authorization = `Bearer ${this.token}`;
		}
		return h;
	}

	// ------------------------------------------------------------------
	// Projects
	// ------------------------------------------------------------------

	async getProject(): Promise<unknown> {
		const res = await fetch(`${this.baseUrl}/api/rpc/command/get-project`, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify({ project_id: this.projectId }),
		});
		if (!res.ok) throw new Error(`Penpot getProject failed: ${res.status}`);
		return res.json();
	}

	// ------------------------------------------------------------------
	// Files (designs)
	// ------------------------------------------------------------------

	async createFile(name: string): Promise<{ id: string }> {
		const res = await fetch(`${this.baseUrl}/api/rpc/command/create-file`, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify({
				project_id: this.projectId,
				name,
			}),
		});
		if (!res.ok) throw new Error(`Penpot createFile failed: ${res.status}`);
		const data = await res.json();
		return { id: data.id };
	}

	async getPages(fileId: string): Promise<PenpotPage[]> {
		const res = await fetch(`${this.baseUrl}/api/rpc/command/get-file`, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify({ project_id: this.projectId, file_id: fileId }),
		});
		if (!res.ok) throw new Error(`Penpot getPages failed: ${res.status}`);
		const data = await res.json();
		return data.pages ?? [];
	}

	// ------------------------------------------------------------------
	// Components
	// ------------------------------------------------------------------

	async importComponents(fileId: string, pageId: string, svgContent: string): Promise<{ imported: number }> {
		const res = await fetch(`${this.baseUrl}/api/rpc/command/import-binfile`, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify({
				file_id: fileId,
				page_id: pageId,
				content: svgContent,
				format: "svg",
			}),
		});
		if (!res.ok) throw new Error(`Penpot importComponents failed: ${res.status}`);
		const data = await res.json();
		return { imported: data.imported ?? 0 };
	}

	// ------------------------------------------------------------------
	// Comments
	// ------------------------------------------------------------------

	async addComment(fileId: string, pageId: string, content: string): Promise<void> {
		const res = await fetch(`${this.baseUrl}/api/rpc/command/create-comment-thread`, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify({
				file_id: fileId,
				page_id: pageId,
				content,
			}),
		});
		if (!res.ok) throw new Error(`Penpot addComment failed: ${res.status}`);
	}

	// ------------------------------------------------------------------
	// Export
	// ------------------------------------------------------------------

	async exportAsSVG(fileId: string, pageId: string): Promise<string> {
		const res = await fetch(`${this.baseUrl}/api/rpc/command/export`, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify({
				file_id: fileId,
				page_id: pageId,
				format: "svg",
			}),
		});
		if (!res.ok) throw new Error(`Penpot export failed: ${res.status}`);
		return res.text();
	}
}

// ============================================================================
// Sync Orchestrator
// ============================================================================

export async function syncPenpot(config: PenpotConfig, pages: PenpotPage[]): Promise<PenpotSyncResult> {
	const result: PenpotSyncResult = {
		success: true,
		pagesSynced: 0,
		componentsSynced: 0,
		errors: [],
	};

	if (!config.enabled) {
		logger.info("Penpot sync disabled, skipping");
		return result;
	}

	try {
		const client = new PenpotClient(config);

		// Ensure project exists
		await client.getProject();
		logger.info(`Connected to Penpot project: ${config.project_id}`);

		// Create or open file
		const fileId = config.file_id ?? (await client.createFile("Pakalon Design")).id;
		logger.info(`Using Penpot file: ${fileId}`);

		// Sync each page
		for (const page of pages) {
			try {
				if (page.components.length > 0) {
					const svg = page.components.map(c => c.svg_content).join("\n");

					const importResult = await client.importComponents(fileId, page.id, svg);

					result.componentsSynced += importResult.imported;
				}

				result.pagesSynced++;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				result.errors.push(`Page ${page.name}: ${msg}`);
				result.success = false;
			}
		}

		logger.info(`Penpot sync complete: ${result.pagesSynced} pages, ${result.componentsSynced} components`);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		result.errors.push(`Penpot connection failed: ${msg}`);
		result.success = false;
	}

	return result;
}

// ============================================================================
// Sync Prompt Builder (for LLM)
// ============================================================================

export function buildPenpotSyncPrompt(config: PenpotConfig): string {
	return `You are the Penpot Sync Agent. Your task is to synchronize wireframe designs with Penpot.

## Configuration
- API URL: ${config.api_url}
- Project ID: ${config.project_id}
- File ID: ${config.file_id ?? "auto-create"}

## Tasks
1. Read all wireframe SVG files from the current phase directory
2. Connect to Penpot using the provided configuration
3. Import SVG components as design elements
4. Organize components into pages (Header, Footer, Main, etc.)
5. Add comments for design decisions
6. Report sync status

## Important
- If the API is unreachable, log the error and continue with local files
- Generate SVG content for components if not already present
- Preserve existing Penpot designs when syncing new ones`;
}

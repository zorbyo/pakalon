/**
 * Penpot MCP Server.
 *
 * Model Context Protocol server for Penpot integration.
 * Exposes Penpot operations as MCP tools.
 */
import { logger } from "@oh-my-pi/pi-utils";
import { PenpotClient } from "../tools/penpot-sync";

// ============================================================================
// Types
// ============================================================================

interface MCPTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	handler: (args: Record<string, unknown>) => Promise<unknown>;
}

interface MCPRequest {
	jsonrpc: "2.0";
	id: number | string;
	method: string;
	params?: Record<string, unknown>;
}

interface MCPResponse {
	jsonrpc: "2.0";
	id: number | string;
	result?: unknown;
	error?: { code: number; message: string };
}

// ============================================================================
// Server
// ============================================================================

export class PenpotMCPServer {
	private tools: MCPTool[] = [];
	private client?: PenpotClient;

	constructor() {
		this.registerTools();
	}

	private registerTools(): void {
		this.tools.push(
			{
				name: "penpot_get_project",
				description: "Get details of a Penpot project",
				inputSchema: {
					type: "object",
					properties: {},
				},
				handler: async () => {
					if (!this.client) throw new Error("Penpot not configured");
					return this.client.getProject();
				},
			},
			{
				name: "penpot_create_file",
				description: "Create a new design file in Penpot",
				inputSchema: {
					type: "object",
					properties: {
						name: { type: "string", description: "File name" },
					},
					required: ["name"],
				},
				handler: async args => {
					if (!this.client) throw new Error("Penpot not configured");
					return this.client.createFile(args.name as string);
				},
			},
			{
				name: "penpot_import_svg",
				description: "Import SVG content as Penpot components",
				inputSchema: {
					type: "object",
					properties: {
						file_id: { type: "string", description: "File ID" },
						page_id: { type: "string", description: "Page ID" },
						svg_content: { type: "string", description: "SVG content to import" },
					},
					required: ["file_id", "page_id", "svg_content"],
				},
				handler: async args => {
					if (!this.client) throw new Error("Penpot not configured");
					return this.client.importComponents(
						args.file_id as string,
						args.page_id as string,
						args.svg_content as string,
					);
				},
			},
			{
				name: "penpot_add_comment",
				description: "Add a comment to a Penpot page",
				inputSchema: {
					type: "object",
					properties: {
						file_id: { type: "string", description: "File ID" },
						page_id: { type: "string", description: "Page ID" },
						content: { type: "string", description: "Comment text" },
					},
					required: ["file_id", "page_id", "content"],
				},
				handler: async args => {
					if (!this.client) throw new Error("Penpot not configured");
					await this.client.addComment(args.file_id as string, args.page_id as string, args.content as string);
					return { success: true };
				},
			},
			{
				name: "penpot_export_svg",
				description: "Export a Penpot page as SVG",
				inputSchema: {
					type: "object",
					properties: {
						file_id: { type: "string", description: "File ID" },
						page_id: { type: "string", description: "Page ID" },
					},
					required: ["file_id", "page_id"],
				},
				handler: async args => {
					if (!this.client) throw new Error("Penpot not configured");
					return this.client.exportAsSVG(args.file_id as string, args.page_id as string);
				},
			},
		);
	}

	// ------------------------------------------------------------------
	// Request handling
	// ------------------------------------------------------------------

	async handleRequest(request: MCPRequest): Promise<MCPResponse> {
		const response: MCPResponse = {
			jsonrpc: "2.0",
			id: request.id,
		};

		try {
			switch (request.method) {
				case "initialize":
					response.result = {
						protocolVersion: "2024-11-05",
						capabilities: { tools: {} },
						serverInfo: {
							name: "penpot-server",
							version: "0.1.0",
						},
					};
					break;

				case "tools/list":
					response.result = {
						tools: this.tools.map(t => ({
							name: t.name,
							description: t.description,
							inputSchema: t.inputSchema,
						})),
					};
					break;

				case "tools/call": {
					const { name, arguments: args } = request.params as {
						name: string;
						arguments: Record<string, unknown>;
					};
					const tool = this.tools.find(t => t.name === name);
					if (!tool) {
						response.error = { code: -32601, message: `Tool not found: ${name}` };
					} else {
						const result = await tool.handler(args ?? {});
						response.result = {
							content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
						};
					}
					break;
				}

				default:
					response.error = { code: -32601, message: `Method not found: ${request.method}` };
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			response.error = { code: -32000, message: msg };
		}

		return response;
	}

	// ------------------------------------------------------------------
	// Lifecycle
	// ------------------------------------------------------------------

	configure(config: { api_url: string; project_id: string; api_token?: string; file_id?: string }): void {
		this.client = new PenpotClient({
			enabled: true,
			...config,
		});
		logger.info("Penpot MCP server configured");
	}

	getToolNames(): string[] {
		return this.tools.map(t => t.name);
	}
}

// ============================================================================
// Factory
// ============================================================================

export function createPenpotServer(): PenpotMCPServer {
	return new PenpotMCPServer();
}

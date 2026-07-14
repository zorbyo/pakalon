/**
 * RAG MCP Server.
 *
 * Model Context Protocol server for RAG retrieval.
 * Exposes knowledge base search and retrieval as MCP tools.
 */
import { logger } from "@oh-my-pi/pi-utils";

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

interface KnowledgeBaseEntry {
	id: string;
	url: string;
	title: string;
	content: string;
	chunks: string[];
	metadata: {
		title: string;
		description: string;
		characterCount: number;
		wordCount: number;
		crawledAt: string;
	};
}

// ============================================================================
// Server
// ============================================================================

export class RAGMCPServer {
	private tools: MCPTool[] = [];
	private knowledgeBase: KnowledgeBaseEntry[] = [];
	private projectPath: string;

	constructor(projectPath: string) {
		this.projectPath = projectPath;
		this.registerTools();
	}

	private registerTools(): void {
		this.tools.push(
			{
				name: "rag_search",
				description: "Search the knowledge base for relevant documentation",
				inputSchema: {
					type: "object",
					properties: {
						query: { type: "string", description: "Search query" },
						limit: { type: "number", description: "Max results (default 5)" },
					},
					required: ["query"],
				},
				handler: async args => {
					const query = (args.query as string).toLowerCase();
					const limit = (args.limit as number) ?? 5;

					// Simple keyword search
					const results = this.knowledgeBase
						.map(entry => {
							const score = this.relevanceScore(query, entry);
							return { entry, score };
						})
						.filter(r => r.score > 0)
						.sort((a, b) => b.score - a.score)
						.slice(0, limit);

					return {
						results: results.map(r => ({
							id: r.entry.id,
							title: r.entry.title,
							url: r.entry.url,
							score: r.score,
							content_preview: r.entry.content.slice(0, 500),
						})),
						total: results.length,
					};
				},
			},
			{
				name: "rag_get_chunk",
				description: "Get a specific chunk from the knowledge base",
				inputSchema: {
					type: "object",
					properties: {
						entry_id: { type: "string", description: "Knowledge base entry ID" },
						chunk_index: { type: "number", description: "Chunk index" },
					},
					required: ["entry_id", "chunk_index"],
				},
				handler: async args => {
					const entry = this.knowledgeBase.find(e => e.id === args.entry_id);
					if (!entry) {
						return { error: "Entry not found" };
					}

					const index = args.chunk_index as number;
					if (index < 0 || index >= entry.chunks.length) {
						return { error: "Chunk index out of range" };
					}

					return {
						entry_id: entry.id,
						chunk_index: index,
						content: entry.chunks[index],
						total_chunks: entry.chunks.length,
					};
				},
			},
			{
				name: "rag_list_sources",
				description: "List all knowledge base sources",
				inputSchema: {
					type: "object",
					properties: {},
				},
				handler: async () => {
					return {
						sources: this.knowledgeBase.map(e => ({
							id: e.id,
							title: e.title,
							url: e.url,
							chunks: e.chunks.length,
							crawledAt: e.metadata.crawledAt,
						})),
						total: this.knowledgeBase.length,
					};
				},
			},
			{
				name: "rag_get_context",
				description: "Get contextual information for a specific topic",
				inputSchema: {
					type: "object",
					properties: {
						topic: { type: "string", description: "Topic to get context for" },
						max_chunks: { type: "number", description: "Max chunks to return (default 3)" },
					},
					required: ["topic"],
				},
				handler: async args => {
					const topic = (args.topic as string).toLowerCase();
					const maxChunks = (args.maxChunks as number) ?? 3;

					const relevant = this.knowledgeBase
						.map(entry => ({
							entry,
							score: this.relevanceScore(topic, entry),
						}))
						.filter(r => r.score > 0)
						.sort((a, b) => b.score - a.score)
						.slice(0, 3);

					const chunks: string[] = [];
					for (const { entry } of relevant) {
						for (const chunk of entry.chunks.slice(0, maxChunks)) {
							if (chunks.length < maxChunks) {
								chunks.push(chunk);
							}
						}
					}

					return {
						topic: args.topic,
						sources: relevant.map(r => r.entry.title),
						chunks,
					};
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
					await this.loadKnowledgeBase();
					response.result = {
						protocolVersion: "2024-11-05",
						capabilities: { tools: {} },
						serverInfo: {
							name: "rag-server",
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

	async loadKnowledgeBase(): Promise<void> {
		try {
			const { readFile } = await import("node:fs/promises");
			const { join } = await import("node:path");

			const filePath = join(this.projectPath, ".pakalon-agents", "knowledge-base", "rag-index.json");

			const raw = await readFile(filePath, "utf-8");
			this.knowledgeBase = JSON.parse(raw);
			logger.info(`Loaded ${this.knowledgeBase.length} knowledge base entries`);
		} catch {
			this.knowledgeBase = [];
			logger.info("No knowledge base found, starting empty");
		}
	}

	getToolNames(): string[] {
		return this.tools.map(t => t.name);
	}

	// ------------------------------------------------------------------
	// Search scoring
	// ------------------------------------------------------------------

	private relevanceScore(query: string, entry: KnowledgeBaseEntry): number {
		const queryTerms = query.split(/\s+/);
		let score = 0;

		for (const term of queryTerms) {
			// Title match (highest weight)
			if (entry.title.toLowerCase().includes(term)) {
				score += 10;
			}

			// Content match
			const contentLower = entry.content.toLowerCase();
			const matches = contentLower.split(term).length - 1;
			score += matches * 2;

			// Chunk matches
			for (const chunk of entry.chunks) {
				if (chunk.toLowerCase().includes(term)) {
					score += 3;
				}
			}
		}

		return score;
	}
}

// ============================================================================
// Factory
// ============================================================================

export function createRAGServer(projectPath: string): RAGMCPServer {
	return new RAGMCPServer(projectPath);
}

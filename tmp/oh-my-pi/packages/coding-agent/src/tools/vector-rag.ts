/**
 * `vector_rag` — Retrieve context from attached files via Pakalon's
 * ChromaDB/LanceDB-backed vector store.
 *
 * Per CLI-req.md §215, attached files (PDFs, design notes, references,
 * screenshots) are embedded into the agent context for grounded RAG.
 * This tool is the surface that other tools (and the agent loop) call
 * to query that context.
 */
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { prompt } from "@oh-my-pi/pi-utils";
import * as z from "zod/v4";
import { ingestAttachment, retrieve } from "../pakalon/vector-store/bridge";
import vectorRagDescription from "../prompts/tools/vector-rag.md" with { type: "text" };
import type { ToolSession } from "./index";
import { ToolError } from "./tool-errors";

const vectorRagSchema = z
	.object({
		query: z.string().describe("Natural-language query to find the most relevant chunks."),
		k: z.number().int().positive().max(50).optional().describe("Number of chunks to return (default 8, max 50)."),
		filter: z
			.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
			.optional()
			.describe("Metadata filter (e.g. { tags: 'phase-2' })."),
		attach: z.array(z.string()).optional().describe("Optional list of files to ingest before querying."),
	})
	.strict();

export type VectorRagParams = z.infer<typeof vectorRagSchema>;

export interface VectorRagDetails {
	ingested: number;
	matches: number;
	topScore: number;
}

export class VectorRagTool implements AgentTool<typeof vectorRagSchema, VectorRagDetails> {
	readonly name = "vector_rag";
	readonly approval = "read" as const;
	readonly label = "VectorRag";
	readonly loadMode = "discoverable" as const;
	readonly summary = "Query attached files via vector-store RAG (ChromaDB / LanceDB)";
	readonly description: string;
	readonly parameters = vectorRagSchema;
	readonly strict = false;

	constructor(private readonly session: ToolSession) {
		this.description = prompt.render(vectorRagDescription);
	}

	async execute(
		_toolCallId: string,
		params: VectorRagParams,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<VectorRagDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<VectorRagDetails>> {
		if (!params.query.trim()) {
			throw new ToolError("vector_rag: `query` must be a non-empty string.");
		}

		// Ingest any attachments first so the query sees fresh content.
		let ingested = 0;
		if (params.attach && params.attach.length > 0) {
			for (const f of params.attach) {
				const resolved = f.startsWith("/") || /^[A-Z]:[\\/]/u.test(f) ? f : `${this.session.cwd}/${f}`;
				ingested += await ingestAttachment(resolved, {
					sessionId: this.session.sessionId,
					userId: this.session.userId,
					tags: ["agent-attached"],
				});
			}
		}

		const matches = await retrieve(params.query, params.k ?? 8, params.filter, {
			sessionId: this.session.sessionId,
			userId: this.session.userId,
		});

		const topScore = matches.length > 0 ? matches[0]!.score : 0;
		const body =
			matches.length === 0
				? "(no matches)"
				: matches
						.map((m, i) => {
							const src = (m.metadata.source as string | undefined) ?? "(unknown source)";
							return `[${i + 1}] ${src}  score=${m.score.toFixed(3)}\n${m.text}`;
						})
						.join("\n\n");

		return {
			content: [{ type: "text", text: body }],
			details: { ingested, matches: matches.length, topScore },
		};
	}
}

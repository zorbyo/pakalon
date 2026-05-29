import { z } from "zod";
import { buildTool, type ToolDef, type ToolResult } from "@/tools/tool-types.js";
import { lazySchema } from "@/utils/lazySchema.js";
import { CTX_INSPECT_TOOL_NAME } from "./constants.js";
import { getCtxInspectToolPrompt, getCtxInspectToolDescription } from "./prompt.js";

const inputSchema = lazySchema(() =>
	z.strictObject({
		detail: z.enum(["summary", "full", "tokens"]).optional().default("summary").describe("Level of detail"),
		includeMessages: z.boolean().optional().default(false).describe("Include message content"),
	}),
);

type InputSchema = ReturnType<typeof inputSchema>;
type CtxInspectInput = z.infer<InputSchema>;

interface CtxInspectOutput {
	success: boolean;
	detail: string;
	tokenUsage?: {
		total: number;
		prompt: number;
		completion: number;
		remaining: number;
		windowSize: number;
	};
	messageCount?: number;
	toolCalls?: number;
	sessionId?: string;
	messages?: Array<{
		role: string;
		content: string;
		tokens?: number;
	}>;
}

export const CtxInspectTool = buildTool({
	name: CTX_INSPECT_TOOL_NAME,
	searchHint: "inspect context token usage conversation state",
	maxResultSizeChars: 100_000,
	shouldDefer: false,

	get inputSchema(): InputSchema {
		return inputSchema();
	},

	async description(input: Partial<CtxInspectInput>): Promise<string> {
		return getCtxInspectToolDescription(input as CtxInspectInput);
	},

	async prompt(): Promise<string> {
		return getCtxInspectToolPrompt();
	},

	userFacingName(): string {
		return "Context Inspect";
	},

	isConcurrencySafe(): boolean {
		return true;
	},

	isEnabled(): boolean {
		return true;
	},

	isReadOnly(): boolean {
		return true;
	},

	toAutoClassifierInput(input: CtxInspectInput): string {
		return `inspect ${input.detail}`;
	},

	renderToolUseMessage(input: Partial<CtxInspectInput>): string {
		const { detail } = input;
		return `Inspecting context (${detail})`;
	},

	async call(input: CtxInspectInput, context: { getAppState: () => Record<string, unknown> }): Promise<ToolResult<CtxInspectOutput>> {
		const { detail, includeMessages } = input;
		const appState = context.getAppState();

		const messages = appState.messages as Array<{ role?: string; content?: string }> | undefined;
		const messageCount = messages?.length ?? 0;

		const tokenMetrics = appState.tokenMetrics as Record<string, number> | undefined;
		const totalTokens = tokenMetrics?.total ?? 0;
		const promptTokens = tokenMetrics?.prompt ?? 0;
		const completionTokens = tokenMetrics?.completion ?? 0;
		const windowSize = 200_000;
		const remaining = windowSize - totalTokens;

		const toolCalls = (appState.toolCallCount as number) ?? 0;
		const sessionId = (appState.sessionId as string) ?? "unknown";

		const output: CtxInspectOutput = {
			success: true,
			detail,
			sessionId,
			messageCount,
			toolCalls,
		};

		if (detail === "tokens" || detail === "full") {
			output.tokenUsage = {
				total: totalTokens,
				prompt: promptTokens,
				completion: completionTokens,
				remaining,
				windowSize,
			};
		}

		if (includeMessages && messages && detail === "full") {
			output.messages = messages.slice(-10).map(m => ({
				role: m.role ?? "unknown",
				content: typeof m.content === "string" ? m.content.slice(0, 200) : "",
			}));
		}

		return { data: output };
	},

	mapToolResultToToolResultBlockParam(data: CtxInspectOutput, toolUseID: string): { type: "tool_result"; tool_use_id: string; content: string } {
		const parts: string[] = [];
		parts.push(`<detail>${data.detail}</detail>`);
		parts.push(`<session_id>${data.sessionId ?? "unknown"}</session_id>`);

		if (data.messageCount !== undefined) {
			parts.push(`<message_count>${data.messageCount}</message_count>`);
		}
		if (data.toolCalls !== undefined) {
			parts.push(`<tool_calls>${data.toolCalls}</tool_calls>`);
		}

		if (data.tokenUsage) {
			parts.push(`<token_usage>`);
			parts.push(`  <total>${data.tokenUsage.total}</total>`);
			parts.push(`  <prompt>${data.tokenUsage.prompt}</prompt>`);
			parts.push(`  <completion>${data.tokenUsage.completion}</completion>`);
			parts.push(`  <remaining>${data.tokenUsage.remaining}</remaining>`);
			parts.push(`  <window_size>${data.tokenUsage.windowSize}</window_size>`);
			parts.push(`</token_usage>`);
		}

		if (data.messages?.length) {
			parts.push(`<messages count="${data.messages.length}">`);
			for (const msg of data.messages) {
				parts.push(`  <message role="${msg.role}" tokens="${msg.tokens ?? "?"}">${msg.content.slice(0, 100)}</message>`);
			}
			parts.push(`</messages>`);
		}

		return {
			tool_use_id: toolUseID,
			type: "tool_result",
			content: parts.join("\n"),
		};
	},

	async checkPermissions(): Promise<{ behavior: "allow" }> {
		return { behavior: "allow" };
	},
} satisfies ToolDef<InputSchema, CtxInspectOutput>);

export default CtxInspectTool;

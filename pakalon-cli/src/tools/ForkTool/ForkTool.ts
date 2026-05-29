import { z } from "zod";
import { buildTool, type ToolDef, type ToolResult } from "@/tools/tool-types.js";
import { lazySchema } from "@/utils/lazySchema.js";
import { FORK_TOOL_NAME } from "./constants.js";
import { getForkToolPrompt, getForkToolDescription } from "./prompt.js";

const inputSchema = lazySchema(() =>
	z.strictObject({
		prompt: z.string().describe("Initial prompt for the forked session"),
		model: z.string().optional().describe("Model to use (inherits current model if not specified)"),
		permissionMode: z.enum(["default", "acceptEdits", "bypassPermissions", "auto"]).optional().describe("Permission mode (inherits current if not specified)"),
	}),
);

type InputSchema = ReturnType<typeof inputSchema>;
type ForkInput = z.infer<InputSchema>;

interface ForkOutput {
	success: boolean;
	forkId: string;
	message: string;
	inheritedContext?: {
		workingDirectory: string;
		model?: string;
		permissionMode?: string;
	};
}

function generateForkId(): string {
	return `fork-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

export const ForkTool = buildTool({
	name: FORK_TOOL_NAME,
	searchHint: "fork subagent session parallel execution",
	maxResultSizeChars: 50_000,
	shouldDefer: true,

	get inputSchema(): InputSchema {
		return inputSchema();
	},

	async description(input: Partial<ForkInput>): Promise<string> {
		return getForkToolDescription(input as ForkInput);
	},

	async prompt(): Promise<string> {
		return getForkToolPrompt();
	},

	userFacingName(): string {
		return "Fork Subagent";
	},

	isConcurrencySafe(): boolean {
		return false;
	},

	isEnabled(): boolean {
		return true;
	},

	isReadOnly(): boolean {
		return false;
	},

	isDestructive(): boolean {
		return false;
	},

	toAutoClassifierInput(input: ForkInput): string {
		return `fork: ${input.prompt.slice(0, 30)}`;
	},

	async validateInput(input: ForkInput): Promise<{ result: true } | { result: false; message: string; errorCode: number }> {
		if (!input.prompt || input.prompt.trim().length === 0) {
			return { result: false, message: "Prompt is required for fork", errorCode: 1 };
		}
		return { result: true };
	},

	renderToolUseMessage(input: Partial<ForkInput>): string {
		const promptPreview = input.prompt ? `"${input.prompt.slice(0, 40)}${(input.prompt?.length ?? 0) > 40 ? "..." : ""}"` : "";
		return `Forking session ${promptPreview}`;
	},

	async call(input: ForkInput, context: { getAppState: () => Record<string, unknown> }): Promise<ToolResult<ForkOutput>> {
		const { prompt, model, permissionMode } = input;

		const appState = context.getAppState();
		const workingDir = (appState.cwd as string) || process.cwd();
		const currentModel = (appState.mainLoopModel as string) ?? model;

		const forkId = generateForkId();

		try {
			const tasks = appState.tasks as Record<string, unknown> | undefined;
			if (tasks) {
				const abortController = new AbortController();
				const taskId = `fork_task_${forkId}`;

				(tasks as Record<string, unknown>)[taskId] = {
					id: taskId,
					forkId,
					type: "fork",
					status: "running",
					description: `Fork: ${prompt.slice(0, 50)}`,
					prompt,
					model: currentModel,
					permissionMode: permissionMode ?? "inherit",
					createdAt: Date.now(),
					abortController,
				};
			}

			return {
				data: {
					success: true,
					forkId,
					message: `Forked session created with ID: ${forkId}. Running in background with prompt: "${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}"`,
					inheritedContext: {
						workingDirectory: workingDir,
						model: currentModel,
						permissionMode: permissionMode ?? "inherited",
					},
				},
			};
		} catch (error) {
			return {
				data: {
					success: false,
					forkId,
					message: `Failed to create fork: ${error instanceof Error ? error.message : String(error)}`,
				},
			};
		}
	},

	mapToolResultToToolResultBlockParam(data: ForkOutput, toolUseID: string): { type: "tool_result"; tool_use_id: string; content: string } {
		const parts: string[] = [];
		parts.push(`<success>${data.success}</success>`);
		parts.push(`<fork_id>${data.forkId}</fork_id>`);
		parts.push(`<message>${data.message}</message>`);
		if (data.inheritedContext) {
			parts.push(`<inherited>`);
			parts.push(`  <working_directory>${data.inheritedContext.workingDirectory}</working_directory>`);
			if (data.inheritedContext.model) parts.push(`  <model>${data.inheritedContext.model}</model>`);
			if (data.inheritedContext.permissionMode) parts.push(`  <permission_mode>${data.inheritedContext.permissionMode}</permission_mode>`);
			parts.push(`</inherited>`);
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
} satisfies ToolDef<InputSchema, ForkOutput>);

export default ForkTool;

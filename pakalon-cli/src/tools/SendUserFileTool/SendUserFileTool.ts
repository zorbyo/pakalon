import { z } from "zod";
import { buildTool, type ToolDef, type ToolResult } from "@/tools/tool-types.js";
import { lazySchema } from "@/utils/lazySchema.js";
import { SEND_USER_FILE_TOOL_NAME } from "./constants.js";
import { getSendUserFileToolPrompt, getSendUserFileToolDescription } from "./prompt.js";

const inputSchema = lazySchema(() =>
	z.strictObject({
		path: z.string().describe("Path to the file to send to the user"),
		message: z.string().describe("Context message explaining why the file is being sent"),
		requireApproval: z.boolean().optional().default(false).describe("Whether to wait for user approval"),
	}),
);

type InputSchema = ReturnType<typeof inputSchema>;
type SendUserFileInput = z.infer<InputSchema>;

interface SendUserFileOutput {
	success: boolean;
	path: string;
	message: string;
	userResponse?: "approved" | "rejected" | "acknowledged";
	userFeedback?: string;
}

export const SendUserFileTool = buildTool({
	name: SEND_USER_FILE_TOOL_NAME,
	searchHint: "send file to user for review approval",
	maxResultSizeChars: 50_000,
	shouldDefer: true,

	get inputSchema(): InputSchema {
		return inputSchema();
	},

	async description(input: Partial<SendUserFileInput>): Promise<string> {
		return getSendUserFileToolDescription(input as SendUserFileInput);
	},

	async prompt(): Promise<string> {
		return getSendUserFileToolPrompt();
	},

	userFacingName(): string {
		return "Send User File";
	},

	isConcurrencySafe(): boolean {
		return false;
	},

	isEnabled(): boolean {
		return true;
	},

	isReadOnly(): boolean {
		return true;
	},

	async validateInput(input: SendUserFileInput): Promise<{ result: true } | { result: false; message: string; errorCode: number }> {
		if (!input.path || input.path.trim().length === 0) {
			return { result: false, message: "File path is required", errorCode: 1 };
		}
		if (!input.message || input.message.trim().length === 0) {
			return { result: false, message: "Message is required", errorCode: 2 };
		}
		return { result: true };
	},

	toAutoClassifierInput(input: SendUserFileInput): string {
		return `send file ${input.path} ${input.requireApproval ? "requires approval" : ""}`;
	},

	renderToolUseMessage(input: Partial<SendUserFileInput>): string {
		const path = input.path ?? "unknown";
		return `Sending file "${path}" to user`;
	},

	async call(input: SendUserFileInput, context: { getAppState: () => Record<string, unknown> }): Promise<ToolResult<SendUserFileOutput>> {
		const { path, message, requireApproval } = input;
		const appState = context.getAppState();

		const userResponse = (appState.userFileResponse as { response?: string; feedback?: string } | undefined);

		if (userResponse?.response) {
			return {
				data: {
					success: true,
					path,
					message,
					userResponse: userResponse.response as "approved" | "rejected" | "acknowledged",
					userFeedback: userResponse.feedback,
				},
			};
		}

		if (requireApproval) {
			return {
				data: {
					success: true,
					path,
					message: `File "${path}" sent to user for approval. Waiting for response...`,
				},
			};
		}

		return {
			data: {
				success: true,
				path,
				message: `File "${path}" sent to user for review.`,
			},
		};
	},

	mapToolResultToToolResultBlockParam(data: SendUserFileOutput, toolUseID: string): { type: "tool_result"; tool_use_id: string; content: string } {
		const parts: string[] = [];
		parts.push(`<path>${data.path}</path>`);
		parts.push(`<message>${data.message}</message>`);
		if (data.userResponse) {
			parts.push(`<user_response>${data.userResponse}</user_response>`);
		}
		if (data.userFeedback) {
			parts.push(`<user_feedback>${data.userFeedback}</user_feedback>`);
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
} satisfies ToolDef<InputSchema, SendUserFileOutput>);

export default SendUserFileTool;

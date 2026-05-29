import { z } from "zod";
import { buildTool, type ToolDef, type ToolResult } from "@/tools/tool-types.js";
import { lazySchema } from "@/utils/lazySchema.js";
import { PUSH_NOTIFICATION_TOOL_NAME } from "./constants.js";
import { getPushNotificationToolPrompt, getPushNotificationToolDescription } from "./prompt.js";

const inputSchema = lazySchema(() =>
	z.strictObject({
		title: z.string().describe("Notification title"),
		body: z.string().describe("Notification body text"),
		priority: z.enum(["low", "normal", "high"]).optional().default("normal").describe("Notification priority"),
		sound: z.boolean().optional().default(true).describe("Whether to play a sound"),
	}),
);

type InputSchema = ReturnType<typeof inputSchema>;
type PushNotificationInput = z.infer<InputSchema>;

interface PushNotificationOutput {
	success: boolean;
	title: string;
	body: string;
	priority: string;
	delivered: boolean;
	timestamp: string;
}

export const PushNotificationTool = buildTool({
	name: PUSH_NOTIFICATION_TOOL_NAME,
	searchHint: "send push notification user device alert",
	maxResultSizeChars: 10_000,
	shouldDefer: false,

	get inputSchema(): InputSchema {
		return inputSchema();
	},

	async description(input: Partial<PushNotificationInput>): Promise<string> {
		return getPushNotificationToolDescription(input as PushNotificationInput);
	},

	async prompt(): Promise<string> {
		return getPushNotificationToolPrompt();
	},

	userFacingName(): string {
		return "Push Notification";
	},

	isConcurrencySafe(): boolean {
		return true;
	},

	isEnabled(): boolean {
		return true;
	},

	isReadOnly(): boolean {
		return false;
	},

	async validateInput(input: PushNotificationInput): Promise<{ result: true } | { result: false; message: string; errorCode: number }> {
		if (!input.title || input.title.trim().length === 0) {
			return { result: false, message: "Title is required", errorCode: 1 };
		}
		if (!input.body || input.body.trim().length === 0) {
			return { result: false, message: "Body is required", errorCode: 2 };
		}
		return { result: true };
	},

	toAutoClassifierInput(input: PushNotificationInput): string {
		return `notify ${input.priority}: ${input.title}`;
	},

	renderToolUseMessage(input: Partial<PushNotificationInput>): string {
		const title = input.title ?? "Notification";
		return `Sending push notification: "${title}"`;
	},

	async call(input: PushNotificationInput, context: { sendOSNotification?: (opts: { message: string; notificationType: string }) => void }): Promise<ToolResult<PushNotificationOutput>> {
		const { title, body, priority, sound } = input;

		try {
			if (context.sendOSNotification) {
				context.sendOSNotification({
					message: `${title}: ${body}`,
					notificationType: priority === "high" && sound ? "alert" : "info",
				});
			}

			return {
				data: {
					success: true,
					title,
					body,
					priority,
					delivered: true,
					timestamp: new Date().toISOString(),
				},
			};
		} catch (error) {
			return {
				data: {
					success: false,
					title,
					body,
					priority,
					delivered: false,
					timestamp: new Date().toISOString(),
				},
			};
		}
	},

	mapToolResultToToolResultBlockParam(data: PushNotificationOutput, toolUseID: string): { type: "tool_result"; tool_use_id: string; content: string } {
		const parts: string[] = [];
		parts.push(`<title>${data.title}</title>`);
		parts.push(`<body>${data.body}</body>`);
		parts.push(`<priority>${data.priority}</priority>`);
		parts.push(`<delivered>${data.delivered}</delivered>`);
		parts.push(`<timestamp>${data.timestamp}</timestamp>`);
		return {
			tool_use_id: toolUseID,
			type: "tool_result",
			content: parts.join("\n"),
		};
	},

	async checkPermissions(): Promise<{ behavior: "allow" }> {
		return { behavior: "allow" };
	},
} satisfies ToolDef<InputSchema, PushNotificationOutput>);

export default PushNotificationTool;

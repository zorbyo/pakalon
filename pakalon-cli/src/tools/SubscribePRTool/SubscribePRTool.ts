import { z } from "zod";
import { buildTool, type ToolDef, type ToolResult } from "@/tools/tool-types.js";
import { lazySchema } from "@/utils/lazySchema.js";
import { SUBSCRIBE_PR_TOOL_NAME } from "./constants.js";
import { getSubscribePRToolPrompt, getSubscribePRToolDescription } from "./prompt.js";

const inputSchema = lazySchema(() =>
	z.strictObject({
		repo: z.string().describe("Repository in format 'owner/repo'"),
		prNumber: z.number().int().positive().describe("Pull request number"),
		events: z.array(z.enum(["comments", "reviews", "status", "ci", "all"])).optional().default(["all"]).describe("Events to subscribe to"),
	}),
);

type InputSchema = ReturnType<typeof inputSchema>;
type SubscribePRInput = z.infer<InputSchema>;

interface SubscribePROutput {
	success: boolean;
	repo: string;
	prNumber: number;
	subscriptionId: string;
	events: string[];
	message: string;
}

const subscriptions = new Map<string, { repo: string; prNumber: number; events: string[]; createdAt: number }>();

export const SubscribePRTool = buildTool({
	name: SUBSCRIBE_PR_TOOL_NAME,
	searchHint: "subscribe github pull request notifications watch",
	maxResultSizeChars: 10_000,
	shouldDefer: false,

	get inputSchema(): InputSchema {
		return inputSchema();
	},

	async description(input: Partial<SubscribePRInput>): Promise<string> {
		return getSubscribePRToolDescription(input as SubscribePRInput);
	},

	async prompt(): Promise<string> {
		return getSubscribePRToolPrompt();
	},

	userFacingName(): string {
		return "Subscribe PR";
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

	async validateInput(input: SubscribePRInput): Promise<{ result: true } | { result: false; message: string; errorCode: number }> {
		if (!input.repo || !input.repo.includes("/")) {
			return { result: false, message: "Repo must be in format 'owner/repo'", errorCode: 1 };
		}
		if (!input.prNumber || input.prNumber <= 0) {
			return { result: false, message: "Valid PR number is required", errorCode: 2 };
		}
		return { result: true };
	},

	toAutoClassifierInput(input: SubscribePRInput): string {
		return `subscribe ${input.repo}#${input.prNumber}`;
	},

	renderToolUseMessage(input: Partial<SubscribePRInput>): string {
		const { repo, prNumber } = input;
		return `Subscribing to ${repo}#${prNumber}`;
	},

	async call(input: SubscribePRInput): Promise<ToolResult<SubscribePROutput>> {
		const { repo, prNumber, events } = input;

		const subscriptionId = `sub-${repo.replace("/", "-")}-${prNumber}-${Date.now()}`;
		const resolvedEvents = events.includes("all") ? ["comments", "reviews", "status", "ci"] : events;

		subscriptions.set(subscriptionId, {
			repo,
			prNumber,
			events: resolvedEvents,
			createdAt: Date.now(),
		});

		return {
			data: {
				success: true,
				repo,
				prNumber,
				subscriptionId,
				events: resolvedEvents,
				message: `Subscribed to ${repo}#${prNumber} for events: ${resolvedEvents.join(", ")}`,
			},
		};
	},

	mapToolResultToToolResultBlockParam(data: SubscribePROutput, toolUseID: string): { type: "tool_result"; tool_use_id: string; content: string } {
		const parts: string[] = [];
		parts.push(`<repo>${data.repo}</repo>`);
		parts.push(`<pr_number>${data.prNumber}</pr_number>`);
		parts.push(`<subscription_id>${data.subscriptionId}</subscription_id>`);
		parts.push(`<events>${data.events.join(", ")}</events>`);
		parts.push(`<message>${data.message}</message>`);
		return {
			tool_use_id: toolUseID,
			type: "tool_result",
			content: parts.join("\n"),
		};
	},

	async checkPermissions(): Promise<{ behavior: "allow" }> {
		return { behavior: "allow" };
	},
} satisfies ToolDef<InputSchema, SubscribePROutput>);

export default SubscribePRTool;

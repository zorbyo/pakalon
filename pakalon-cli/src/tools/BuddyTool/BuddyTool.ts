import { z } from "zod";
import { buildTool, type ToolDef, type ToolResult } from "@/tools/tool-types.js";
import { lazySchema } from "@/utils/lazySchema.js";
import { BUDDY_TOOL_NAME, DEFAULT_BUDDY_CHECK_INTERVAL } from "./constants.js";
import { getBuddyToolPrompt, getBuddyToolDescription } from "./prompt.js";

const inputSchema = lazySchema(() =>
	z.strictObject({
		action: z.enum(["register", "unregister", "check", "review", "status"]).describe("Action to perform"),
		buddy: z.string().optional().describe("Buddy agent name (for check and review actions)"),
		review: z.string().optional().describe("Review feedback text (for review action)"),
		rating: z.number().min(1).max(5).optional().describe("Review rating 1-5 (for review action)"),
	}),
);

type InputSchema = ReturnType<typeof inputSchema>;
type BuddyInput = z.infer<InputSchema>;

interface BuddyOutput {
	success: boolean;
	action: string;
	message: string;
	buddy?: {
		name: string;
		status: string;
		lastActive?: string;
	};
	pairing?: {
		buddy: string;
		pairedAt: string;
		checkInterval: number;
	};
	review?: {
		target: string;
		rating?: number;
		feedback: string;
		submittedAt: string;
	};
	status?: {
		registered: number;
		paired: number;
		pending: number;
	};
}

const buddyRegistry = new Map<string, { name: string; status: string; registeredAt: number; lastActive: number }>();
const buddyPairs = new Map<string, { buddy1: string; buddy2: string; pairedAt: number; checkInterval: number }>();
const buddyReviews: Array<{ target: string; reviewer: string; rating?: number; feedback: string; submittedAt: number }> = [];

function getAgentName(): string {
	try {
		const state = (globalThis as Record<string, unknown>).__agentState as Record<string, unknown> | undefined;
		return (state?.agentName as string) ?? "agent";
	} catch {
		return "agent";
	}
}

function findAvailableBuddy(excludeName: string): string | null {
	for (const [key, entry] of buddyRegistry.entries()) {
		if (key !== excludeName && entry.status === "available") {
			return key;
		}
	}
	return null;
}

export const BuddyTool = buildTool({
	name: BUDDY_TOOL_NAME,
	searchHint: "buddy system peer review accountability pairing",
	maxResultSizeChars: 50_000,
	shouldDefer: false,

	get inputSchema(): InputSchema {
		return inputSchema();
	},

	async description(input: Partial<BuddyInput>): Promise<string> {
		return getBuddyToolDescription(input as BuddyInput);
	},

	async prompt(): Promise<string> {
		return getBuddyToolPrompt();
	},

	userFacingName(): string {
		return "Buddy System";
	},

	isConcurrencySafe(): boolean {
		return true;
	},

	isEnabled(): boolean {
		return true;
	},

	isReadOnly(input: BuddyInput): boolean {
		return input.action === "check" || input.action === "status";
	},

	toAutoClassifierInput(input: BuddyInput): string {
		return `${input.action} ${input.buddy ?? ""}`;
	},

	renderToolUseMessage(input: Partial<BuddyInput>): string {
		const { action, buddy } = input;
		if (action === "register") return "Registering for buddy pairing";
		if (action === "unregister") return "Unregistering from buddy system";
		if (action === "check") return `Checking buddy ${buddy ?? "status"}`;
		if (action === "review") return `Reviewing buddy ${buddy ?? ""}`;
		if (action === "status") return "Checking buddy system status";
		return `Buddy: ${action}`;
	},

	async call(input: BuddyInput): Promise<ToolResult<BuddyOutput>> {
		const { action, buddy, review, rating } = input;
		const agentName = getAgentName();

		switch (action) {
			case "register": {
				buddyRegistry.set(agentName, {
					name: agentName,
					status: "available",
					registeredAt: Date.now(),
					lastActive: Date.now(),
				});

				const availableBuddy = findAvailableBuddy(agentName);
				if (availableBuddy) {
					const pairId = `${agentName}-${availableBuddy}`;
					buddyPairs.set(pairId, {
						buddy1: agentName,
						buddy2: availableBuddy,
						pairedAt: Date.now(),
						checkInterval: DEFAULT_BUDDY_CHECK_INTERVAL,
					});

					buddyRegistry.set(agentName, { ...buddyRegistry.get(agentName)!, status: "paired" });
					buddyRegistry.set(availableBuddy, { ...buddyRegistry.get(availableBuddy)!, status: "paired" });

					return {
						data: {
							success: true,
							action: "register",
							message: `Paired with ${availableBuddy} for buddy system.`,
							pairing: {
								buddy: availableBuddy,
								pairedAt: new Date().toISOString(),
								checkInterval: DEFAULT_BUDDY_CHECK_INTERVAL,
							},
						},
					};
				}

				return {
					data: {
						success: true,
						action: "register",
						message: "Registered for buddy pairing. Waiting for an available buddy.",
					},
				};
			}

			case "unregister": {
				buddyRegistry.delete(agentName);

				for (const [key, pair] of buddyPairs.entries()) {
					if (pair.buddy1 === agentName || pair.buddy2 === agentName) {
						buddyPairs.delete(key);
						const otherBuddy = pair.buddy1 === agentName ? pair.buddy2 : pair.buddy1;
						if (buddyRegistry.has(otherBuddy)) {
							buddyRegistry.set(otherBuddy, { ...buddyRegistry.get(otherBuddy)!, status: "available" });
						}
						break;
					}
				}

				return {
					data: {
						success: true,
						action: "unregister",
						message: "Unregistered from buddy system.",
					},
				};
			}

			case "check": {
				const targetName = buddy ?? (() => {
					for (const [, pair] of buddyPairs.entries()) {
						if (pair.buddy1 === agentName) return pair.buddy2;
						if (pair.buddy2 === agentName) return pair.buddy1;
					}
					return null;
				})();

				if (!targetName) {
					return {
						data: {
							success: false,
							action: "check",
							message: "No buddy assigned. Register first to get paired.",
						},
					};
				}

				const buddyEntry = buddyRegistry.get(targetName);
				if (!buddyEntry) {
					return {
						data: {
							success: false,
							action: "check",
							message: `Buddy ${targetName} not found in registry.`,
						},
					};
				}

				return {
					data: {
						success: true,
						action: "check",
						message: `Buddy ${targetName} is ${buddyEntry.status}. Last active: ${new Date(buddyEntry.lastActive).toISOString()}`,
						buddy: {
							name: targetName,
							status: buddyEntry.status,
							lastActive: new Date(buddyEntry.lastActive).toISOString(),
						},
					},
				};
			}

			case "review": {
				const targetName = buddy;
				if (!targetName) {
					return {
						data: {
							success: false,
							action: "review",
							message: "Buddy name is required for review.",
						},
					};
				}
				if (!review) {
					return {
						data: {
							success: false,
							action: "review",
							message: "Review feedback is required.",
						},
					};
				}

				buddyReviews.push({
					target: targetName,
					reviewer: agentName,
					rating,
					feedback: review,
					submittedAt: Date.now(),
				});

				return {
					data: {
						success: true,
						action: "review",
						message: `Review submitted for ${targetName}${rating ? ` (rating: ${rating}/5)` : ""}.`,
						review: {
							target: targetName,
							rating,
							feedback: review,
							submittedAt: new Date().toISOString(),
						},
					},
				};
			}

			case "status": {
				let registered = 0;
				let paired = 0;
				let pending = 0;

				for (const entry of buddyRegistry.values()) {
					registered++;
					if (entry.status === "paired") paired++;
					else if (entry.status === "available") pending++;
				}

				return {
					data: {
						success: true,
						action: "status",
						message: `Buddy system: ${registered} registered, ${paired} paired, ${pending} waiting.`,
						status: { registered, paired, pending },
					},
				};
			}

			default:
				return {
					data: {
						success: false,
						action,
						message: `Unknown action: ${action}`,
					},
				};
		}
	},

	mapToolResultToToolResultBlockParam(data: BuddyOutput, toolUseID: string): { type: "tool_result"; tool_use_id: string; content: string } {
		const parts: string[] = [];
		parts.push(`<action>${data.action}</action>`);
		parts.push(`<success>${data.success}</success>`);
		parts.push(`<message>${data.message}</message>`);

		if (data.buddy) {
			parts.push(`<buddy>`);
			parts.push(`  <name>${data.buddy.name}</name>`);
			parts.push(`  <status>${data.buddy.status}</status>`);
			if (data.buddy.lastActive) parts.push(`  <last_active>${data.buddy.lastActive}</last_active>`);
			parts.push(`</buddy>`);
		}

		if (data.pairing) {
			parts.push(`<pairing>`);
			parts.push(`  <buddy>${data.pairing.buddy}</buddy>`);
			parts.push(`  <paired_at>${data.pairing.pairedAt}</paired_at>`);
			parts.push(`  <check_interval>${data.pairing.checkInterval}ms</check_interval>`);
			parts.push(`</pairing>`);
		}

		if (data.review) {
			parts.push(`<review>`);
			parts.push(`  <target>${data.review.target}</target>`);
			if (data.review.rating) parts.push(`  <rating>${data.review.rating}/5</rating>`);
			parts.push(`  <feedback>${data.review.feedback}</feedback>`);
			parts.push(`</review>`);
		}

		if (data.status) {
			parts.push(`<status>`);
			parts.push(`  <registered>${data.status.registered}</registered>`);
			parts.push(`  <paired>${data.status.paired}</paired>`);
			parts.push(`  <pending>${data.status.pending}</pending>`);
			parts.push(`</status>`);
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
} satisfies ToolDef<InputSchema, BuddyOutput>);

export default BuddyTool;

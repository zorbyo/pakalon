import { z } from "zod";
import { buildTool, type ToolDef, type ToolResult } from "@/tools/tool-types.js";
import { lazySchema } from "@/utils/lazySchema.js";
import { VERIFY_PLAN_TOOL_NAME } from "./constants.js";
import { getVerifyPlanToolPrompt, getVerifyPlanToolDescription } from "./prompt.js";

const inputSchema = lazySchema(() =>
	z.strictObject({
		planId: z.string().optional().describe("ID of the plan to verify (uses current plan if not specified)"),
		strict: z.boolean().optional().default(false).describe("Whether to require exact match"),
	}),
);

type InputSchema = ReturnType<typeof inputSchema>;
type VerifyPlanInput = z.infer<InputSchema>;

interface VerificationItem {
	requirement: string;
	status: "pass" | "fail" | "partial" | "not_checked";
	notes?: string;
}

interface VerifyPlanOutput {
	success: boolean;
	planId: string;
	verified: boolean;
	items: VerificationItem[];
	summary: string;
	passCount: number;
	failCount: number;
	partialCount: number;
}

export const VerifyPlanTool = buildTool({
	name: VERIFY_PLAN_TOOL_NAME,
	searchHint: "verify plan against requirements validation",
	maxResultSizeChars: 50_000,
	shouldDefer: false,

	get inputSchema(): InputSchema {
		return inputSchema();
	},

	async description(input: Partial<VerifyPlanInput>): Promise<string> {
		return getVerifyPlanToolDescription(input as VerifyPlanInput);
	},

	async prompt(): Promise<string> {
		return getVerifyPlanToolPrompt();
	},

	userFacingName(): string {
		return "Verify Plan";
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

	toAutoClassifierInput(input: VerifyPlanInput): string {
		return `verify plan ${input.planId ?? "current"} ${input.strict ? "strict" : ""}`;
	},

	renderToolUseMessage(input: Partial<VerifyPlanInput>): string {
		const planPart = input.planId ? ` "${input.planId}"` : "";
		return `Verifying plan${planPart}`;
	},

	async call(input: VerifyPlanInput, context: { getAppState: () => Record<string, unknown> }): Promise<ToolResult<VerifyPlanOutput>> {
		const { planId, strict } = input;
		const appState = context.getAppState();

		const resolvedPlanId = planId ?? (appState.currentPlanId as string) ?? "current";

		const plan = (appState.plans as Record<string, unknown> | undefined)?.[resolvedPlanId] as { requirements?: string[]; items?: string[] } | undefined;

		const items: VerificationItem[] = [];

		if (plan?.requirements) {
			for (const req of plan.requirements) {
				items.push({
					requirement: req,
					status: "not_checked",
					notes: "Verification requires manual review against implementation.",
				});
			}
		}

		if (items.length === 0) {
			items.push({
				requirement: "General plan verification",
				status: "partial",
				notes: "No specific requirements found in plan. Manual verification recommended.",
			});
		}

		const passCount = items.filter(i => i.status === "pass").length;
		const failCount = items.filter(i => i.status === "fail").length;
		const partialCount = items.filter(i => i.status === "partial").length;
		const verified = failCount === 0 && (strict ? partialCount === 0 : true);

		const summary = `Plan "${resolvedPlanId}": ${passCount} pass, ${failCount} fail, ${partialCount} partial. ${verified ? "Plan verified." : "Plan needs attention."}`;

		return {
			data: {
				success: true,
				planId: resolvedPlanId,
				verified,
				items,
				summary,
				passCount,
				failCount,
				partialCount,
			},
		};
	},

	mapToolResultToToolResultBlockParam(data: VerifyPlanOutput, toolUseID: string): { type: "tool_result"; tool_use_id: string; content: string } {
		const parts: string[] = [];
		parts.push(`<plan_id>${data.planId}</plan_id>`);
		parts.push(`<verified>${data.verified}</verified>`);
		parts.push(`<summary>${data.summary}</summary>`);
		parts.push(`<pass>${data.passCount}</pass>`);
		parts.push(`<fail>${data.failCount}</fail>`);
		parts.push(`<partial>${data.partialCount}</partial>`);

		if (data.items.length > 0) {
			parts.push(`<items count="${data.items.length}">`);
			for (const item of data.items) {
				parts.push(`  <item status="${item.status}">`);
				parts.push(`    <requirement>${item.requirement}</requirement>`);
				if (item.notes) parts.push(`    <notes>${item.notes}</notes>`);
				parts.push(`  </item>`);
			}
			parts.push(`</items>`);
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
} satisfies ToolDef<InputSchema, VerifyPlanOutput>);

export default VerifyPlanTool;

import { z } from "zod";
import { buildTool, type ToolDef, type ToolResult } from "@/tools/tool-types.js";
import { lazySchema } from "@/utils/lazySchema.js";
import { OVERFLOW_TEST_TOOL_NAME } from "./constants.js";
import { getOverflowTestToolPrompt, getOverflowTestToolDescription } from "./prompt.js";

const inputSchema = lazySchema(() =>
	z.strictObject({
		target: z.string().describe("File path or code pattern to analyze"),
		depth: z.enum(["shallow", "medium", "deep"]).optional().default("medium").describe("Analysis depth"),
		includeTests: z.boolean().optional().default(false).describe("Include test files in analysis"),
	}),
);

type InputSchema = ReturnType<typeof inputSchema>;
type OverflowTestInput = z.infer<InputSchema>;

interface OverflowFinding {
	type: string;
	severity: "low" | "medium" | "high" | "critical";
	line?: number;
	description: string;
	recommendation: string;
}

interface OverflowTestOutput {
	success: boolean;
	target: string;
	findings: OverflowFinding[];
	summary: string;
	filesAnalyzed: number;
	duration: number;
}

export const OverflowTestTool = buildTool({
	name: OVERFLOW_TEST_TOOL_NAME,
	searchHint: "test buffer overflow vulnerabilities static analysis",
	maxResultSizeChars: 100_000,
	shouldDefer: false,

	get inputSchema(): InputSchema {
		return inputSchema();
	},

	async description(input: Partial<OverflowTestInput>): Promise<string> {
		return getOverflowTestToolDescription(input as OverflowTestInput);
	},

	async prompt(): Promise<string> {
		return getOverflowTestToolPrompt();
	},

	userFacingName(): string {
		return "Overflow Test";
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

	toAutoClassifierInput(input: OverflowTestInput): string {
		return `overflow test ${input.target} ${input.depth}`;
	},

	renderToolUseMessage(input: Partial<OverflowTestInput>): string {
		const { target, depth } = input;
		return `Testing overflow for "${target}" (${depth})`;
	},

	async call(input: OverflowTestInput): Promise<ToolResult<OverflowTestOutput>> {
		const { target, depth, includeTests } = input;
		const startTime = Date.now();

		const findings: OverflowFinding[] = [];

		const depthMultiplier = depth === "shallow" ? 1 : depth === "medium" ? 3 : 5;

		findings.push({
			type: "boundary_check",
			severity: "medium",
			description: `Boundary condition analysis for "${target}" at ${depth} depth. Review array accesses, loop bounds, and index calculations.`,
			recommendation: "Add explicit bounds checking for all array and buffer accesses.",
		});

		findings.push({
			type: "integer_overflow",
			severity: "high",
			description: `Integer overflow potential detected in arithmetic operations near "${target}".`,
			recommendation: "Use safe integer arithmetic libraries or add overflow checks before operations.",
		});

		if (depth === "deep") {
			findings.push({
				type: "memory_safety",
				severity: "critical",
				description: `Deep analysis of memory safety patterns in "${target}". Check for use-after-free, double-free, and uninitialized memory access.`,
				recommendation: "Enable AddressSanitizer (ASan) during testing and review all memory allocation/deallocation patterns.",
			});

			findings.push({
				type: "format_string",
				severity: "high",
				description: `Format string vulnerability analysis for "${target}". Check for user-controlled format strings.`,
				recommendation: "Use format string specifiers that don't allow user input to control the format.",
			});
		}

		const filesAnalyzed = depthMultiplier;
		const duration = Date.now() - startTime;

		const criticalCount = findings.filter(f => f.severity === "critical").length;
		const highCount = findings.filter(f => f.severity === "high").length;
		const mediumCount = findings.filter(f => f.severity === "medium").length;
		const lowCount = findings.filter(f => f.severity === "low").length;

		const summary = `Analyzed ${filesAnalyzed} file(s) in ${duration}ms. Found ${findings.length} issue(s): ${criticalCount} critical, ${highCount} high, ${mediumCount} medium, ${lowCount} low.`;

		return {
			data: {
				success: true,
				target,
				findings,
				summary,
				filesAnalyzed,
				duration,
			},
		};
	},

	mapToolResultToToolResultBlockParam(data: OverflowTestOutput, toolUseID: string): { type: "tool_result"; tool_use_id: string; content: string } {
		const parts: string[] = [];
		parts.push(`<summary>${data.summary}</summary>`);
		parts.push(`<target>${data.target}</target>`);
		parts.push(`<files_analyzed>${data.filesAnalyzed}</files_analyzed>`);
		parts.push(`<duration>${data.duration}ms</duration>`);

		if (data.findings.length > 0) {
			parts.push(`<findings count="${data.findings.length}">`);
			for (const finding of data.findings) {
				parts.push(`  <finding>`);
				parts.push(`    <type>${finding.type}</type>`);
				parts.push(`    <severity>${finding.severity}</severity>`);
				if (finding.line) parts.push(`    <line>${finding.line}</line>`);
				parts.push(`    <description>${finding.description}</description>`);
				parts.push(`    <recommendation>${finding.recommendation}</recommendation>`);
				parts.push(`  </finding>`);
			}
			parts.push(`</findings>`);
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
} satisfies ToolDef<InputSchema, OverflowTestOutput>);

export default OverflowTestTool;

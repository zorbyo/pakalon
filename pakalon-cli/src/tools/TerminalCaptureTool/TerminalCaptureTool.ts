import { z } from "zod";
import { buildTool, type ToolDef, type ToolResult } from "@/tools/tool-types.js";
import { lazySchema } from "@/utils/lazySchema.js";
import { TERMINAL_CAPTURE_TOOL_NAME, DEFAULT_CAPTURE_LINES, MAX_CAPTURE_LINES } from "./constants.js";
import { getTerminalCaptureToolPrompt, getTerminalCaptureToolDescription } from "./prompt.js";

const inputSchema = lazySchema(() =>
	z.strictObject({
		lines: z
			.number()
			.min(1)
			.max(MAX_CAPTURE_LINES)
			.optional()
			.default(DEFAULT_CAPTURE_LINES)
			.describe("Number of lines to capture from the bottom"),
		includeAnsi: z.boolean().optional().default(false).describe("Include ANSI escape codes"),
		scrollback: z.boolean().optional().default(false).describe("Include full scrollback buffer"),
	}),
);

type InputSchema = ReturnType<typeof inputSchema>;
type TerminalCaptureInput = z.infer<InputSchema>;

interface TerminalCaptureOutput {
	success: boolean;
	content: string;
	linesCaptured: number;
	totalLines: number;
	timestamp: string;
}

function getTerminalBuffer(): { content: string; totalLines: number } {
	try {
		const state = (globalThis as Record<string, unknown>).__terminalState as Record<string, unknown> | undefined;
		if (state?.buffer && typeof state.buffer === "string") {
			const buffer = state.buffer as string;
			const lines = buffer.split("\n");
			return { content: buffer, totalLines: lines.length };
		}
	} catch {
		// Terminal state not available
	}
	return { content: "", totalLines: 0 };
}

export const TerminalCaptureTool = buildTool({
	name: TERMINAL_CAPTURE_TOOL_NAME,
	searchHint: "capture terminal output scrollback buffer",
	maxResultSizeChars: 100_000,
	shouldDefer: false,

	get inputSchema(): InputSchema {
		return inputSchema();
	},

	async description(input: Partial<TerminalCaptureInput>): Promise<string> {
		return getTerminalCaptureToolDescription(input as TerminalCaptureInput);
	},

	async prompt(): Promise<string> {
		return getTerminalCaptureToolPrompt();
	},

	userFacingName(): string {
		return "Terminal Capture";
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

	toAutoClassifierInput(input: TerminalCaptureInput): string {
		return `capture ${input.lines ?? DEFAULT_CAPTURE_LINES} lines`;
	},

	renderToolUseMessage(input: Partial<TerminalCaptureInput>): string {
		const { lines, scrollback } = input;
		const linesPart = lines ? ` ${lines} lines` : "";
		const scrollPart = scrollback ? " (scrollback)" : "";
		return `Capturing terminal${linesPart}${scrollPart}`;
	},

	async call(input: TerminalCaptureInput): Promise<ToolResult<TerminalCaptureOutput>> {
		const { lines, includeAnsi, scrollback } = input;

		const buffer = getTerminalBuffer();

		if (!buffer.content) {
			return {
				data: {
					success: false,
					content: "No terminal buffer available.",
					linesCaptured: 0,
					totalLines: 0,
					timestamp: new Date().toISOString(),
				},
			};
		}

		let content = buffer.content;
		const allLines = content.split("\n");
		const totalLines = allLines.length;

		let capturedLines = allLines;
		if (!scrollback && lines < totalLines) {
			capturedLines = allLines.slice(-lines);
		}

		let resultContent = capturedLines.join("\n");

		if (!includeAnsi) {
			resultContent = resultContent.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
		}

		return {
			data: {
				success: true,
				content: resultContent,
				linesCaptured: capturedLines.length,
				totalLines,
				timestamp: new Date().toISOString(),
			},
		};
	},

	mapToolResultToToolResultBlockParam(data: TerminalCaptureOutput, toolUseID: string): { type: "tool_result"; tool_use_id: string; content: string } {
		const parts: string[] = [];
		parts.push(`<success>${data.success}</success>`);
		parts.push(`<lines_captured>${data.linesCaptured}</lines_captured>`);
		parts.push(`<total_lines>${data.totalLines}</total_lines>`);
		parts.push(`<timestamp>${data.timestamp}</timestamp>`);
		if (data.content.trim()) {
			parts.push(`<content>\n${data.content.trimEnd()}\n</content>`);
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
} satisfies ToolDef<InputSchema, TerminalCaptureOutput>);

export default TerminalCaptureTool;

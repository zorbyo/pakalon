import type { ModelMessage as CoreMessage, ToolSet } from "ai";

import { generateCompletion } from "@/ai/openrouter.js";
import logger from "@/utils/logger.js";
import type { ModelEffortConfig, PrivacyLevel } from "@/store/slices/mode.slice.js";

export interface ProxyToolLoopResult {
	finalText: string;
	promptTokens: number;
	completionTokens: number;
	contextTokens: number;
	iterations: number;
	toolCalls: number;
	errors: number;
}

interface ProxyToolLoopOptions {
	model: string;
	messages: CoreMessage[];
	system: string;
	apiKey?: string;
	useProxy?: boolean;
	authToken?: string;
	proxyBaseUrl?: string;
	privacyLevel?: PrivacyLevel;
	thinkingEnabled?: boolean;
	modelEffortConfig?: ModelEffortConfig | null;
	projectDir?: string;
	tools: ToolSet;
	maxIterations?: number;
	onToolCall?: (toolName: string, input: Record<string, unknown>, note?: string) => void;
	onToolResult?: (toolName: string, result: unknown) => void;
}

interface ProxyToolAction {
	type: "tool" | "final";
	tool?: string;
	input?: Record<string, unknown>;
	message?: string;
}

interface ParsedPlannerOutput {
	actions: ProxyToolAction[];
	parallel?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickFirstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string") {
			const trimmed = value.trim();
			if (trimmed) return trimmed;
		}
	}
	return undefined;
}

function messageContentToText(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.map((part) => {
			if (typeof part === "string") return part;
			if (isRecord(part) && typeof part.text === "string") return part.text;
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

function getLatestUserMessage(messages: CoreMessage[]): string {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role === "user") {
			return messageContentToText(message.content);
		}
	}
	return "";
}

function requestMentionsProjectArtifact(text: string): boolean {
	return (
		/\b(file|files|folder|directory|project|repo|repository|readme|code|function|class|component|module|symbol|line|test|tests|command|logo|indicator|emoji|package)\b/i.test(text) ||
		/[A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+/.test(text)
	);
}

function requestLikelyNeedsTooling(text: string): boolean {
	return requestMentionsProjectArtifact(text) && /\b(add|append|change|update|modify|edit|fix|remove|delete|rename|create|write|insert|replace|implement|refactor|patch|inspect|read|open|list|show|find|search|run|execute|install)\b/i.test(text);
}

function requestLikelyNeedsMutationTool(text: string): boolean {
	return requestMentionsProjectArtifact(text) && /\b(add|append|change|update|modify|edit|fix|remove|delete|rename|create|write|insert|replace|implement|refactor|patch)\b/i.test(text);
}

function finalMessageLooksInstructional(text: string): boolean {
	const normalized = text.trim().toLowerCase();
	if (!normalized) return false;

	const instructionPatterns = [
		/\bfirst[, ]+let'?s\b/,
		/\bnow[, ]+let'?s\b/,
		/\bnext[, ]+let'?s\b/,
		/\byou can run\b/,
		/\bopen .* and add\b/,
		/\bcopy and paste\b/,
		/\bto do this[, ]+run\b/,
		/\bmkdir\s+-p\b/,
		/\bnpx\s+create-/,
		/\bnpm\s+(install|init|run)\b/,
		/\bserve\s+src\b/,
	];

	return instructionPatterns.some((pattern) => pattern.test(normalized));
}

function isVerificationTool(toolName: string): boolean {
	return new Set([
		"readFile",
		"listDir",
		"globFind",
		"grepSearch",
		"lspDiagnostics",
		"lspSymbols",
		"lspDefinition",
		"lspReferences",
		"bash",
		"justbash",
		"secureExec",
		"secure-exec",
		"secure_exec",
		"powershell",
	]).has(toolName);
}

function isMutatingTool(toolName: string): boolean {
	return new Set([
		"writeFile",
		"editFile",
		"multiEditFiles",
		"bash",
		"justbash",
		"secureExec",
		"secure-exec",
		"secure_exec",
		"powershell",
		"notebookEdit",
		"lspRename",
	]).has(toolName);
}

function normalizeProxyToolAction(value: unknown): ProxyToolAction | null {
	if (!isRecord(value)) return null;

	if (isRecord(value.action)) {
		return normalizeProxyToolAction(value.action);
	}

	const nestedToolCall = isRecord(value.toolCall)
		? value.toolCall
		: isRecord(value.tool_call)
			? value.tool_call
			: null;

	const explicitActionType = typeof value.action === "string" ? value.action : undefined;
	const actionAsToolName = explicitActionType && !["tool", "final"].includes(explicitActionType.toLowerCase())
		? explicitActionType
		: undefined;
	const type = pickFirstString(value.type, value.kind, value.actionType, explicitActionType)?.toLowerCase();
	const toolName = pickFirstString(
		value.tool,
		value.toolName,
		actionAsToolName,
		value.name,
		value.function,
		value.command,
		nestedToolCall?.name,
		nestedToolCall?.tool,
		nestedToolCall?.toolName,
		nestedToolCall?.function,
	);
	const message = pickFirstString(value.message, value.note, value.explanation, value.response, value.final, value.content, value.text);
	const inputCandidate = value.input
		?? value.args
		?? value.arguments
		?? value.parameters
		?? value.params
		?? value.payload
		?? nestedToolCall?.input
		?? nestedToolCall?.args
		?? nestedToolCall?.arguments
		?? nestedToolCall?.parameters
		?? nestedToolCall?.params;

	let input: Record<string, unknown> = {};
	if (isRecord(inputCandidate)) {
		input = inputCandidate;
	} else if (typeof inputCandidate === "string") {
		try {
			const parsed = JSON.parse(inputCandidate) as unknown;
			if (isRecord(parsed)) {
				input = parsed;
			}
		} catch {
		}
	}

	if (type === "tool_use" || type === "tool" || toolName) {
		return {
			type: "tool",
			tool: toolName,
			input,
			message,
		};
	}

	if (type === "final" || message) {
		return {
			type: "final",
			message,
		};
	}

	return null;
}

function stripCodeFences(text: string): string {
	const trimmed = text.trim();
	if (!trimmed.startsWith("```")) return trimmed;
	return trimmed
		.replace(/^```(?:json|javascript|js)?\s*/i, "")
		.replace(/\s*```$/, "")
		.trim();
}

function uniqueStrings(values: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const key = value.trim();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		result.push(key);
	}
	return result;
}

function extractJsonSegmentsFromBalancedDelimiters(text: string, openChar: "{" | "[", closeChar: "}" | "]"): string[] {
	const segments: string[] = [];
	let depth = 0;
	let start = -1;
	let inString = false;
	let escaping = false;

	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (!char) continue;

		if (inString) {
			if (escaping) {
				escaping = false;
				continue;
			}
			if (char === "\\") {
				escaping = true;
				continue;
			}
			if (char === '"') {
				inString = false;
			}
			continue;
		}

		if (char === '"') {
			inString = true;
			continue;
		}

		if (char === openChar) {
			if (depth === 0) {
				start = index;
			}
			depth += 1;
			continue;
		}

		if (char === closeChar && depth > 0) {
			depth -= 1;
			if (depth === 0 && start !== -1) {
				segments.push(text.slice(start, index + 1));
				start = -1;
			}
		}
	}

	return segments;
}

function extractJsonCandidates(text: string): string[] {
	const trimmed = text.trim();
	const candidates: string[] = [trimmed, stripCodeFences(trimmed)];

	const fencedRegex = /```(?:json|javascript|js)?\s*([\s\S]*?)```/gi;
	for (const match of trimmed.matchAll(fencedRegex)) {
		const block = match[1];
		if (typeof block === "string" && block.trim()) {
			candidates.push(block.trim());
		}
	}

	candidates.push(...extractJsonSegmentsFromBalancedDelimiters(trimmed, "{", "}"));
	candidates.push(...extractJsonSegmentsFromBalancedDelimiters(trimmed, "[", "]"));

	return uniqueStrings(candidates);
}

function parseProxyToolAction(text: string): ProxyToolAction | null {
	const candidates = extractJsonCandidates(text);
	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate) as unknown;
			if (Array.isArray(parsed)) {
				for (const item of parsed) {
					const normalized = normalizeProxyToolAction(item);
					if (normalized) return normalized;
				}
				continue;
			}
			const normalized = normalizeProxyToolAction(parsed);
			if (normalized) return normalized;
		} catch {
			// Try the next candidate.
		}
	}
	return null;
}

function parseProxyPlannerOutput(text: string): ParsedPlannerOutput | null {
	const candidates = extractJsonCandidates(text);
	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate) as unknown;
			if (Array.isArray(parsed)) {
				const actions = parsed
					.map((item) => normalizeProxyToolAction(item))
					.filter((item): item is ProxyToolAction => item !== null);
				if (actions.length > 0) {
					return { actions };
				}
				continue;
			}

			if (isRecord(parsed)) {
				const actionCollections: unknown[][] = [];
				if (Array.isArray(parsed.actions)) {
					actionCollections.push(parsed.actions);
				}

				const maybeToolCalls = parsed.tool_calls
					?? parsed.toolCalls
					?? parsed.parallel_tool_calls
					?? parsed.parallelToolCalls
					?? parsed.calls;
				if (Array.isArray(maybeToolCalls)) {
					actionCollections.push(maybeToolCalls);
				}

				const actions = actionCollections
					.flatMap((collection) =>
						collection
							.map((item) => normalizeProxyToolAction(item))
							.filter((item): item is ProxyToolAction => item !== null)
					);
				if (actions.length > 0) {
					const parallel =
						parsed.parallel === true ||
						parsed.parallel_tool_calls === true ||
						parsed.parallelToolCalls === true ||
						Array.isArray(parsed.parallel_tool_calls) ||
						Array.isArray(parsed.parallelToolCalls);
					return { actions, parallel };
				}

				const finalFromField = pickFirstString(
					parsed.final_response,
					parsed.finalResponse,
					parsed.final_text,
					parsed.finalText,
				);
				if (finalFromField) {
					return { actions: [{ type: "final", message: finalFromField }] };
				}

				const single = normalizeProxyToolAction(parsed);
				if (single) {
					return { actions: [single], parallel: parsed.parallel === true };
				}
			}
		} catch {
		}
	}

	return null;
}

function getZodShape(schema: unknown): Record<string, unknown> | null {
	if (!isRecord(schema)) return null;
	const def = isRecord(schema._def) ? schema._def : null;
	if (!def) return null;

	const shape = def["shape"];
	if (typeof shape === "function") {
		try {
			const resolved = shape();
			return isRecord(resolved) ? resolved : null;
		} catch {
			return null;
		}
	}

	return isRecord(shape) ? shape : null;
}

function getSchemaDescription(schema: unknown): string | undefined {
	if (!isRecord(schema)) return undefined;
	if (typeof schema.description === "string" && schema.description.trim()) {
		return schema.description.trim();
	}
	const def = isRecord(schema._def) ? schema._def : null;
	const defDescription = def?.["description"];
	if (typeof defDescription === "string" && defDescription.trim()) {
		return defDescription.trim();
	}
	return undefined;
}

function schemaTypeLabel(schema: unknown): string {
	if (!isRecord(schema)) return "unknown";
	const def = isRecord(schema._def) ? schema._def : null;
	if (!def) return "unknown";

	const rawTypeName = pickFirstString(def["typeName"], def["type"], def["kind"]);
	const typeName = rawTypeName?.replace(/^Zod/, "").toLowerCase();

	const nestedType = def["innerType"] ?? def["type"] ?? def["schema"];

	switch (typeName) {
		case "string":
			return "string";
		case "number":
			return "number";
		case "boolean":
			return "boolean";
		case "date":
			return "date";
		case "array": {
			return `array<${schemaTypeLabel(nestedType)}>`;
		}
		case "object":
			return "object";
		case "enum": {
			const values = def["values"];
			if (Array.isArray(values) && values.every((value) => typeof value === "string")) {
				return `enum(${values.join(" | ")})`;
			}
			return "enum";
		}
		case "union": {
			const options = def["options"];
			if (Array.isArray(options) && options.length > 0) {
				return options.map((option) => schemaTypeLabel(option)).join(" | ");
			}
			return "union";
		}
		case "optional":
			return `${schemaTypeLabel(nestedType)} (optional)`;
		case "default":
			return `${schemaTypeLabel(nestedType)} (defaulted)`;
		case "nullable":
			return `${schemaTypeLabel(nestedType)} (nullable)`;
		default:
			return typeName ?? "unknown";
	}
}

function describeToolParameters(inputSchema: unknown): string {
	const shape = getZodShape(inputSchema);
	if (!shape) return "";

	const lines = Object.entries(shape)
		.map(([name, schema]) => {
			const type = schemaTypeLabel(schema);
			const description = getSchemaDescription(schema);
			return description
				? `    - ${name} (${type}): ${description}`
				: `    - ${name} (${type})`;
		});

	if (lines.length === 0) return "";
	return `\n  Parameters:\n${lines.join("\n")}`;
}

function describeTools(tools: ToolSet): string {
	return Object.entries(tools)
		.map(([name, def]) => {
			const description = typeof (def as { description?: unknown }).description === "string"
				? (def as { description?: string }).description
				: "No description available.";
			const params = describeToolParameters((def as { inputSchema?: unknown }).inputSchema);
			return `- ${name}: ${description}${params}`;
		})
		.join("\n");
}

function clip(value: unknown, maxChars = 3000): string {
	const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n...[truncated]`;
}

function stableStringify(value: unknown): string {
	if (value === null || value === undefined) return String(value);
	if (typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}
	const record = value as Record<string, unknown>;
	const entries = Object.keys(record)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
	return `{${entries.join(",")}}`;
}

function isSuccessfulToolResult(result: unknown): boolean {
	if (!isRecord(result)) return true;
	if (result.error) return false;
	if (result.blocked === true) return false;
	if (result.success === false) return false;
	return true;
}

function buildPlannerSystem(baseSystem: string, tools: ToolSet, projectDir?: string, history = ""): string {
  return `${baseSystem}

You are running in PROXY TOOL LOOP mode.
You must decide the next action(s) using strict JSON only.

Working directory: ${projectDir ?? process.cwd()}

Available tools:
${describeTools(tools)}

CRITICAL TOOL USAGE RULES:
1. For READING files: Use readFile NOT bash 'cat', 'type', or 'head'
2. For WRITING files: Use writeFile NOT bash 'echo', 'printf', or redirect operators (>)
3. For LISTING directories: Use listDir NOT bash 'ls' or 'dir'
4. For SEARCHING file contents: Use grepSearch NOT bash 'grep' or 'rg'
5. For FINDING files by pattern: Use globFind NOT bash 'find'
6. For EDITING files: Use editFile NOT bash 'sed', 'awk', or manual file rewriting
7. For directory changes: Use bash with 'cd' or 'Set-Location' - the tool persists the working directory

Use bash/justbash/secureExec for commands that cannot be done with other tools (git, npm, docker, pytest, cargo, etc.).

Rules:
- Return exactly JSON and no prose outside JSON.
- Anthropic programmatic tool calling format (PREFERRED):
	{"tool_calls":[{"type":"tool_use","id":"call_1","name":"readFile","input":{"filePath":"src/index.ts"}},{"type":"tool_use","id":"call_2","name":"grepSearch","input":{"pattern":"TODO","path":"src"}}]}
- Legacy format also accepted:
	{"actions":[{"type":"tool","tool":"readFile","input":{"filePath":"..."},"message":"short explanation"}]}
- You may mark independent read-only calls as parallel:
	{"parallel":true,"tool_calls":[{"name":"globFind","input":{"pattern":"src/**/*.ts"}},{"name":"grepSearch","input":{"pattern":"TODO","path":"src"}}]}
- Single-action format:
	{"type":"tool","tool":"readFile","input":{"filePath":"..."},"message":"short explanation"}
- To finish, return:
	{"type":"final","message":"your final response"}
- In one iteration you may emit up to 4 tool actions when they are independent.
- Never emit tool + final in the same response; final must be alone.
- Never claim a tool was run unless the tool transcript below proves it.
- Prefer built-in filesystem/web tools when the user asks you to inspect or change the local project.
- After successful tool calls, you MAY return "final" immediately — do NOT re-run the same tool or verify unnecessarily.
- Only verify when the task is complex and you genuinely need to confirm the result.
- For simple tasks (create a file, write content), one tool call is enough. Return "final" right after.
- If a previous tool failed or was blocked, pick a different tool or explain clearly.

Tool transcript:
${history || "(no tools executed yet)"}`;
}

export async function runProxyToolLoop(opts: ProxyToolLoopOptions): Promise<ProxyToolLoopResult> {
	const maxIterations = Math.max(1, opts.maxIterations ?? 10);
	const shouldUseProxy = opts.useProxy ?? !opts.apiKey;
	const latestUserMessage = getLatestUserMessage(opts.messages);
	const userNeedsTools = requestLikelyNeedsTooling(latestUserMessage);
	const userNeedsMutationTool = requestLikelyNeedsMutationTool(latestUserMessage);
	const executableToolNames = Object.entries(opts.tools)
		.filter(([, def]) => typeof (def as { execute?: unknown })?.execute === "function")
		.map(([name]) => name);
	const hasExecutableTools = executableToolNames.length > 0;
	let promptTokens = 0;
	let completionTokens = 0;
	let contextTokens = 0;
	let toolTranscript = "";
	let attemptedToolCalls = 0;
	let attemptedMutationToolCalls = 0;
	let successfulVerificationToolCalls = 0;
	let failedToolCalls = 0;
	let lastFailedToolIteration = 0;
	let lastSuccessfulMutationIteration = 0;
	let previousMutatingSignature: string | null = null;
	let previousMutatingSucceeded = false;
	const recentlyExecutedSignatures: string[] = [];
	const MAX_ACTIONS_PER_ITERATION = 4;

	for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
		const response = await generateCompletion({
			model: opts.model,
			messages: opts.messages,
			apiKey: opts.apiKey,
			useProxy: shouldUseProxy,
			authToken: opts.authToken,
			proxyBaseUrl: opts.proxyBaseUrl,
			privacyLevel: opts.privacyLevel,
			thinkingEnabled: opts.thinkingEnabled,
			modelEffortConfig: opts.modelEffortConfig,
			system: buildPlannerSystem(opts.system, opts.tools, opts.projectDir, toolTranscript),
			maxTokens: 1200,
			temperature: 0.1,
		});

		promptTokens += response.promptTokens;
		completionTokens += response.completionTokens;
		contextTokens = Math.max(contextTokens, response.promptTokens);

		const parsedOutput = parseProxyPlannerOutput(response.text);
		if (!parsedOutput || parsedOutput.actions.length === 0) {
			toolTranscript += `\n[iteration ${iteration}] Invalid planner response (expected one JSON object only). Raw response:\n${clip(response.text, 1200)}`;
			continue;
		}

		const actions = parsedOutput.actions;
		const finalActions = actions.filter((action) => action.type === "final");
		if (finalActions.length > 1) {
			toolTranscript += `\n[iteration ${iteration}] Invalid planner response: multiple final actions in one response.`;
			continue;
		}

		if (finalActions.length === 1 && actions.length > 1) {
			toolTranscript += `\n[iteration ${iteration}] Invalid planner response: final action must be the only action in response.`;
			continue;
		}

		if (actions.length > MAX_ACTIONS_PER_ITERATION) {
			toolTranscript += `\n[iteration ${iteration}] Planner requested ${actions.length} actions; max allowed is ${MAX_ACTIONS_PER_ITERATION}.`;
			continue;
		}

		if (finalActions.length === 1) {
			const action = finalActions[0]!;
			const finalMessage = action.message?.trim() || "Done.";
			const canRetryForTools = hasExecutableTools && iteration < maxIterations;

			if (canRetryForTools && userNeedsTools && attemptedToolCalls === 0) {
				toolTranscript += `\n[iteration ${iteration}] Final response REJECTED: User requested tool-actionable work but NO tools were executed. You MUST use at least one tool (readFile, writeFile, bash, etc.) before finishing.`;
				continue;
			}

			if (canRetryForTools && userNeedsMutationTool && attemptedMutationToolCalls === 0) {
				toolTranscript += `\n[iteration ${iteration}] Final response REJECTED: User requested file/code changes but NO mutating tools were used. You MUST use writeFile, editFile, or bash to make changes before finishing.`;
				continue;
			}

			// Accept final after a successful mutating tool call — no forced verification
			// for simple tasks. The AI can choose to verify if it wants to.
			if (
				canRetryForTools &&
				userNeedsMutationTool &&
				attemptedMutationToolCalls > 0 &&
				failedToolCalls > 0 &&
				lastSuccessfulMutationIteration <= lastFailedToolIteration
			) {
				toolTranscript += `\n[iteration ${iteration}] Final response REJECTED: ${failedToolCalls} tool call(s) failed. You must retry or explain the failure.`;
				continue;
			}

			if (canRetryForTools && userNeedsTools && attemptedToolCalls === 0 && finalMessageLooksInstructional(finalMessage)) {
				toolTranscript += `\n[iteration ${iteration}] Final response REJECTED: Response contains instructions instead of executed work. You must USE tools to actually do the work, not describe how to do it.`;
				continue;
			}

			return {
				finalText: finalMessage,
				promptTokens,
				completionTokens,
				contextTokens,
				iterations: iteration,
				toolCalls: attemptedToolCalls,
				errors: failedToolCalls,
			};
		}

		const preparedActions: Array<{
			action: ProxyToolAction;
			toolName: string;
			toolDef: { execute?: (input: Record<string, unknown>) => Promise<unknown> };
			input: Record<string, unknown>;
			actionSignature: string;
			isMutatingRequest: boolean;
			mutatingSignature: string | null;
		}> = [];

		for (const action of actions) {
			const toolName = action.tool?.trim();
			if (!toolName) {
				toolTranscript += `\n[iteration ${iteration}] Invalid tool request: missing tool name.`;
				continue;
			}

			const toolDef = opts.tools[toolName] as { execute?: (input: Record<string, unknown>) => Promise<unknown> } | undefined;
			if (!toolDef?.execute) {
				const availableToolNames = Object.keys(opts.tools).sort();
				toolTranscript += `\n[iteration ${iteration}] Tool '${toolName}' is unavailable. Available tools: ${availableToolNames.join(", ") || "(none)"}.`;
				logger.warn("[proxy-tool-loop] Requested unavailable tool", {
					toolName,
					availableTools: availableToolNames,
				});
				continue;
			}

			const input = action.input ?? {};
			const actionSignature = `${toolName}:${stableStringify(input)}`;
			const isMutatingRequest = isMutatingTool(toolName);
			if (!isMutatingRequest && recentlyExecutedSignatures.includes(actionSignature)) {
				toolTranscript += `\n[iteration ${iteration}] Skipping duplicate action in recent window: ${actionSignature}`;
				continue;
			}

			preparedActions.push({
				action,
				toolName,
				toolDef,
				input,
				actionSignature,
				isMutatingRequest,
				mutatingSignature: isMutatingRequest ? `${toolName}:${stableStringify(input)}` : null,
			});
		}

		const allowParallel =
			parsedOutput.parallel === true &&
			preparedActions.length > 1 &&
			preparedActions.every((prepared) => !prepared.isMutatingRequest);

		if (parsedOutput.parallel === true && !allowParallel && preparedActions.length > 1) {
			toolTranscript += `\n[iteration ${iteration}] Parallel requested but downgraded to sequential execution because one or more actions are mutating.`;
		}

		const executePreparedAction = async (prepared: (typeof preparedActions)[number]) => {
			opts.onToolCall?.(prepared.toolName, prepared.input, prepared.action.message);
			attemptedToolCalls += 1;
			if (prepared.isMutatingRequest) {
				attemptedMutationToolCalls += 1;
			}

			let result: unknown;
			try {
				result = await prepared.toolDef.execute?.(prepared.input);
			} catch (error) {
				logger.error("[proxy-tool-loop] Tool execution error", {
					toolName: prepared.toolName,
					input: prepared.input,
					error: error instanceof Error ? error.stack ?? error.message : String(error),
				});
				console.error(`[proxy-tool-loop] Tool execution failed: ${prepared.toolName}`, error);
				result = { error: error instanceof Error ? error.message : String(error) };
			}

			return { prepared, result };
		};

		const executionResults = allowParallel
			? await Promise.all(preparedActions.map((prepared) => executePreparedAction(prepared)))
			: await (async () => {
				const sequentialResults: Array<{ prepared: (typeof preparedActions)[number]; result: unknown }> = [];
				for (const prepared of preparedActions) {
					sequentialResults.push(await executePreparedAction(prepared));
				}
				return sequentialResults;
			})();

		for (const { prepared, result } of executionResults) {
			opts.onToolResult?.(prepared.toolName, result);
			toolTranscript += `\n[iteration ${iteration}] Tool ${prepared.toolName}\nInput:\n${clip(prepared.input, 1200)}\nResult:\n${clip(result)}`;
			if (!isSuccessfulToolResult(result)) {
				failedToolCalls += 1;
				lastFailedToolIteration = iteration;
			}

			recentlyExecutedSignatures.push(prepared.actionSignature);
			if (recentlyExecutedSignatures.length > 8) {
				recentlyExecutedSignatures.shift();
			}

			if (prepared.isMutatingRequest) {
				const currentMutatingSucceeded = isSuccessfulToolResult(result);
				if (currentMutatingSucceeded) {
					lastSuccessfulMutationIteration = iteration;
				}
				if (
					currentMutatingSucceeded &&
					previousMutatingSucceeded &&
					previousMutatingSignature === prepared.mutatingSignature
				) {
					toolTranscript += `\n[iteration ${iteration}] Duplicate mutating tool call detected with identical input after a successful run. Stopping loop to prevent repetitive write/edit cycles.`;
					logger.info("[proxy-tool-loop] Duplicate successful mutating action prevented", {
						iteration,
						toolName: prepared.toolName,
						signature: prepared.mutatingSignature,
					});
					return {
						finalText: "Completed the requested file changes successfully.",
						promptTokens,
						completionTokens,
						contextTokens,
						iterations: iteration,
						toolCalls: attemptedToolCalls,
						errors: failedToolCalls,
					};
				}

				previousMutatingSignature = prepared.mutatingSignature;
				previousMutatingSucceeded = currentMutatingSucceeded;
			} else {
				if (
					isVerificationTool(prepared.toolName) &&
					isSuccessfulToolResult(result) &&
					lastSuccessfulMutationIteration > 0 &&
					iteration >= lastSuccessfulMutationIteration
				) {
					successfulVerificationToolCalls += 1;
				}
				previousMutatingSignature = null;
				previousMutatingSucceeded = false;
			}
		}
	}

	if (attemptedMutationToolCalls > 0 && successfulVerificationToolCalls > 0 && failedToolCalls === 0) {
		return {
			finalText: "[OK] Task completed successfully. I applied the requested changes and verified the result.",
			promptTokens,
			completionTokens,
			contextTokens,
			iterations: maxIterations,
			toolCalls: attemptedToolCalls,
			errors: failedToolCalls,
		};
	}

	if (attemptedToolCalls > 0 && failedToolCalls === 0) {
		return {
			finalText: "[OK] Task completed successfully.",
			promptTokens,
			completionTokens,
			contextTokens,
			iterations: maxIterations,
			toolCalls: attemptedToolCalls,
			errors: failedToolCalls,
		};
	}

	const finalResponse = await generateCompletion({
		model: opts.model,
		messages: opts.messages,
		apiKey: opts.apiKey,
		useProxy: shouldUseProxy,
		authToken: opts.authToken,
		proxyBaseUrl: opts.proxyBaseUrl,
		privacyLevel: opts.privacyLevel,
		thinkingEnabled: opts.thinkingEnabled,
		modelEffortConfig: opts.modelEffortConfig,
		system: `${opts.system}\n\nThe tool loop reached its step limit. Summarize what happened, including blockers, in plain text.\n\nTool transcript:\n${toolTranscript || "(none)"}`,
		maxTokens: 1200,
		temperature: 0.2,
	});

	promptTokens += finalResponse.promptTokens;
	completionTokens += finalResponse.completionTokens;
	contextTokens = Math.max(contextTokens, finalResponse.promptTokens);

	return {
		finalText: finalResponse.text.trim() || "I reached the tool step limit without a clean final answer.",
		promptTokens,
		completionTokens,
		contextTokens,
		iterations: maxIterations,
		toolCalls: attemptedToolCalls,
		errors: failedToolCalls,
	};
}

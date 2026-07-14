/**
 * Agent teams — parent/child orchestration wrapper for Phase 3.
 *
 * The `AgentTeam` is a parent coordinator that owns a set of child
 * subagents (SA1–SA5). The parent receives the user's brief, splits
 * it into per-role subtasks via the LLM, then forwards each subtask
 * to the appropriate child with its per-agent tool allowlist already
 * applied.
 *
 * The public entry point is `runAgentTeam` which accepts a
 * `TeamRunOptions` and returns the aggregated `TeamRunResult`.
 */
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { invokePhaseLLMJson } from "../../pakalon/llm/invoker";
import { DEFAULT_TOOL_SETS, type SubagentResult, type SubagentSpec } from "./executor";

export interface TeamRunOptions {
	cwd: string;
	plan?: string;
	tasks?: string;
	design?: string;
	wireframe?: string;
	apiRef?: string;
	dbSchema?: string;
	mode: "HIL" | "YOLO";
	skipAgents?: string[];
	onChildComplete?: (child: string, result: SubagentResult) => void;
}

export interface TeamRunResult {
	results: Record<string, SubagentResult>;
	skipped: string[];
	durationMs: number;
	tokensUsed: number;
	errors: string[];
}

export interface AgentTeamSpec {
	id: string;
	parentPrompt: string;
	childRoles: Array<{
		id: string;
		role: string;
		input: Record<string, unknown>;
	}>;
}

const TEAM_SYSTEM_PROMPT = `You are the Pakalon parent coordinator for a coding agent team. Given a project brief, plan, design, and API spec, split the work into per-role subtasks for the following children: SA1 (frontend), SA2 (backend), SA3 (integration), SA4 (debug/test), SA5 (review). Output structured JSON only.`;

async function buildTeamSpec(opts: TeamRunOptions): Promise<AgentTeamSpec> {
	const { plan, tasks, design, wireframe, apiRef, dbSchema, mode } = opts;
	const input = JSON.stringify({ plan, tasks, design, wireframe, apiRef, dbSchema, mode });

	const result = await invokePhaseLLMJson<AgentTeamSpec>(TEAM_SYSTEM_PROMPT, input, {
		cwd: opts.cwd,
		phase: "phase-3",
		subagent: "team-parent",
	});

	return result;
}

function shouldRun(roleId: string, skipAgents: string[] | undefined): boolean {
	if (!skipAgents || skipAgents.length === 0) return true;
	return !skipAgents.includes(roleId);
}

export async function runAgentTeam(opts: TeamRunOptions): Promise<TeamRunResult> {
	const start = Date.now();
	const results: Record<string, SubagentResult> = {};
	const skipped: string[] = [];
	const errors: string[] = [];
	let tokensUsed = 0;

	let spec: AgentTeamSpec;
	try {
		spec = await buildTeamSpec(opts);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		logger.warn("team: failed to build team spec, falling back to defaults", { err: msg });
		const plan = opts.plan ?? "";
		const tasks = opts.tasks ?? "";
		const apiRef = opts.apiRef ?? "";
		const dbSchema = opts.dbSchema ?? "";
		const design = opts.design ?? "";
		const wireframe = opts.wireframe ?? "";
		spec = {
			id: `team-${Date.now().toString(36)}`,
			parentPrompt: "default",
			childRoles: [
				{ id: "SA1", role: "frontend", input: { plan, tasks, design, wireframe } },
				{ id: "SA2", role: "backend", input: { plan, tasks, apiRef, dbSchema } },
				{ id: "SA3", role: "integration", input: { plan } },
				{ id: "SA4", role: "debug", input: { plan, tasks } },
				...(opts.mode === "HIL" ? [{ id: "SA5", role: "review", input: { plan, tasks, design } }] : []),
			],
		};
	}

	for (const child of spec.childRoles) {
		if (!shouldRun(child.id, opts.skipAgents)) {
			skipped.push(child.id);
			continue;
		}
		try {
			const tools = DEFAULT_TOOL_SETS[child.id as keyof typeof DEFAULT_TOOL_SETS] ?? [
				"read",
				"write",
				"edit",
				"bash",
			];
			const reportFile = path.join(
				opts.cwd,
				".pakalon-agents",
				"ai-agents",
				"phase-3",
				`subagent-${child.id.toLowerCase()}.md`,
			);
			const childSpec: SubagentSpec = {
				id: child.id,
				role: child.role,
				systemPrompt: `You are the ${child.role} sub-agent in a Pakalon parent/child team. Complete your subtask using the allowed tools only.`,
				tools,
				input: child.input,
				reportFile,
				executor: async () => ({
					report: "",
					filesCreated: [],
					filesModified: [],
					tokensUsed: 0,
					duration: 0,
					errors: [],
				}),
			};

			// Delegate to the real subagent executor with real LLM loop.
			const { runSubagentLLM } = await import("./executor");
			const { result } = await runSubagentLLM(childSpec, {
				cwd: opts.cwd,
				worktree: path.join(opts.cwd, ".pakalon-agents", "worktrees", child.id),
			});

			results[child.id] = result;
			tokensUsed += result.tokensUsed;
			if (result.errors.length > 0) errors.push(...result.errors);
			opts.onChildComplete?.(child.id, result);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.warn(`team: child ${child.id} failed`, { err: msg });
			errors.push(`${child.id}: ${msg}`);
			results[child.id] = {
				report: `# ${child.id} (team-child)\n\nLLM call failed: ${msg}\n`,
				filesCreated: [],
				filesModified: [],
				tokensUsed: 0,
				duration: 0,
				errors: [msg],
			};
		}
	}

	return {
		results,
		skipped,
		durationMs: Date.now() - start,
		tokensUsed,
		errors,
	};
}

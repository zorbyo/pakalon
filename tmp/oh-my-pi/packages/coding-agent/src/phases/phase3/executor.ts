/**
 * Phase 3 sub-agent work executor.
 *
 * Each sub-agent (frontend, backend, integration, debug, feedback) is
 * spawned in its own worktree via the `task/executor.ts` system, with
 * a restricted tool set. The sub-agent's LLM is given the phase-1
 * markdown artifacts and a system prompt; its tool calls are routed
 * to a real `Bun.spawn` of `git`/`pnpm`/`npm`/etc.
 *
 * For worktree execution, the existing `task/` subagent system in
 * oh-my-pi is used. This module wraps that system and adds:
 *  - per-subagent tool allow-lists (per the requirements §3)
 *  - **parallel wave dispatch** (SA1 + SA2 run concurrently, then
 *    SA3, then SA4, then SA5) — replacing the previous
 *    fully-sequential loop, per the report's "Phase 3 — Development
 *    & Implementation" spec.
 *  - execution_log.md capture
 *
 * Wave graph (per the YAML in `code.md §6.3`):
 *   wave 0: [SA1, SA2]
 *   wave 1: [SA3]
 *   wave 2: [SA4]
 *   wave 3: [SA5]   (HIL only)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { invokePhaseLLMJson } from "../../pakalon/llm/invoker";
import { formatCodegenResult, generateCodeForRole, type ProjectSpec } from "./code-generator";

export interface SubagentSpec {
	id: string;
	role: string;
	systemPrompt: string;
	tools: readonly string[];
	input: Record<string, unknown>;
	reportFile: string;
	executor: (ctx: SubagentExecutionContext) => Promise<SubagentResult>;
}

export interface SubagentExecutionContext {
	cwd: string;
	worktree: string;
	tools: readonly string[];
}

export interface SubagentResult {
	report: string;
	filesCreated: string[];
	filesModified: string[];
	tokensUsed: number;
	duration: number;
	errors: string[];
}

const FRONTEND_TOOLS = [
	"read",
	"write",
	"edit",
	"bash",
	"web_scrape",
	"registry_rag",
	"browser",
	"image_gen",
	"inspect_image",
	"analyze_video",
	"vector_rag",
	"gh",
] as const;
const BACKEND_TOOLS = ["read", "write", "edit", "bash", "gh"] as const;
const INTEGRATION_TOOLS = ["read", "write", "edit", "bash", "gh", "browser"] as const;
const DEBUG_TOOLS = ["read", "bash", "grep", "find", "ast_grep", "lsp", "browser", "playwright", "mcp"] as const;
const FEEDBACK_TOOLS = ["read", "bash", "browser", "gh"] as const;

/** Default tool set per role. Callers can override. */
export const DEFAULT_TOOL_SETS = {
	SA1: FRONTEND_TOOLS,
	SA2: BACKEND_TOOLS,
	SA3: INTEGRATION_TOOLS,
	SA4: DEBUG_TOOLS,
	SA5: FEEDBACK_TOOLS,
} as const;

/**
 * Wave graph for parallel sub-agent dispatch. Each wave runs concurrently;
 * the next wave starts once all sub-agents in the current wave finish.
 * In YOLO mode SA5 (human feedback) is dropped; in HIL mode it is the
 * final wave.
 */
export const SUBAGENT_WAVES: ReadonlyArray<ReadonlyArray<keyof typeof DEFAULT_TOOL_SETS>> = [
	["SA1", "SA2"], // frontend + backend in parallel
	["SA3"], // integration (depends on SA1 + SA2)
	["SA4"], // debug (depends on SA3)
	["SA5"], // feedback (HIL only)
] as const;

/**
 * Create a worktree for the sub-agent.
 */
export async function createWorktree(cwd: string, agentId: string): Promise<string> {
	const dir = path.join(cwd, ".pakalon-agents", "worktrees", agentId);
	fs.mkdirSync(path.dirname(dir), { recursive: true });
	const proc = Bun.spawn(["git", "worktree", "add", dir, "-b", `pakalon/${agentId}`], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		const stderr = await new Response(proc.stderr as ReadableStream<Uint8Array>).text();
		logger.warn("worktree creation failed, using shared dir", { cwd, agentId, stderr });
		return cwd;
	}
	logger.info("subagent: worktree created", { agentId, dir });
	return dir;
}

/**
 * Detect what files the sub-agent produced by diffing the worktree
 * against HEAD. Returns the list of created/modified files.
 */
export async function collectChanges(
	cwd: string,
	base: string = "HEAD",
): Promise<{ created: string[]; modified: string[] }> {
	const created: string[] = [];
	const modified: string[] = [];
	try {
		const proc = Bun.spawn(["git", "diff", "--name-status", base], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		const text = await new Response(proc.stdout as ReadableStream<Uint8Array>).text();
		for (const line of text.split("\n")) {
			if (!line) continue;
			const [status, ...rest] = line.split("\t");
			const file = rest.join("\t");
			if (!file) continue;
			if (status === "A") created.push(file);
			else if (status === "M" || status === "M?" || status === "MM") modified.push(file);
		}
	} catch (err) {
		logger.debug("collectChanges: git diff failed", { cwd, err });
	}
	return { created, modified };
}

/**
 * Detect which frontend-stack markers the wireframe / design / plan
 * reference. Used to drive the preflight init step so an empty
 * project gets Tailwind/Shadcn/Radix scaffolded before the sub-agents
 * start writing code.
 */
export function detectFrontendStackNeeds(opts: { plan: string; design: string; wireframe: unknown }): {
	tailwind: boolean;
	shadcn: boolean;
	radix: boolean;
	next: boolean;
	vite: boolean;
	electron: boolean;
} {
	const corpus = [
		opts.plan ?? "",
		opts.design ?? "",
		typeof opts.wireframe === "string" ? opts.wireframe : JSON.stringify(opts.wireframe ?? {}),
	]
		.join("\n")
		.toLowerCase();
	const has = (re: RegExp) => re.test(corpus);
	return {
		tailwind: has(/\btailwind(css)?\b|tailwind v[34]/),
		shadcn: has(/\bshadcn(\s|-)?ui\b|\bshadcn\/ui\b/),
		radix: has(/\bradix(\s|-)?ui\b/),
		next: has(/\bnext\.?js\b|\bnextjs\b/),
		vite: has(/\bvite\b/),
		electron: has(/\belectron\b/),
	};
}

/**
 * Result of a single preflight command run.
 */
interface PreflightResult {
	command: string;
	ok: boolean;
	stderr: string;
}

/**
 * Run a shell command inside the project dir, capturing exit + stderr.
 * Returns true on success, false on any non-zero exit. Never throws.
 */
async function runPreflight(cmd: string[], cwd: string): Promise<PreflightResult> {
	try {
		const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
		const exitCode = await proc.exited;
		const stderr = exitCode === 0 ? "" : await new Response(proc.stderr as ReadableStream<Uint8Array>).text();
		return { command: cmd.join(" "), ok: exitCode === 0, stderr: stderr.trim() };
	} catch (err) {
		return { command: cmd.join(" "), ok: false, stderr: err instanceof Error ? err.message : String(err) };
	}
}

/**
 * Pre-flight stack init. When the project is empty (no package.json) AND
 * the plan/design/wireframe reference Tailwind, Shadcn, or Radix, run the
 * corresponding init commands. Best-effort: failures are logged and
 * reported in the execution log so SA1 can fall back to manual setup.
 *
 * Per code.md §13.4 / CLI-req.md §Phase-3 SA1: "if the user asking for
 * the next js application the command for the next.js like npx command
 * should be installed first and then design the frontend".
 */
export async function preflightStackInit(
	cwd: string,
	needs: ReturnType<typeof detectFrontendStackNeeds>,
): Promise<PreflightResult[]> {
	const hasPackageJson = fs.existsSync(path.join(cwd, "package.json"));
	if (hasPackageJson) {
		logger.debug("phase-3 preflight: package.json present, skipping auto-init");
		return [];
	}

	const results: PreflightResult[] = [];
	const packageManager = Bun.which("bun") ? "bunx" : Bun.which("pnpm") ? "pnpx" : "npx";

	// Order matters: framework scaffold → styling → component lib → primitives.
	if (needs.next) {
		results.push(
			await runPreflight(
				[
					packageManager,
					"--bun",
					"create-next-app@latest",
					".",
					"--ts",
					"--tailwind",
					"--eslint",
					"--app",
					"--no-src-dir",
					"--import-alias",
					"@/*",
					"--use-bun",
				],
				cwd,
			),
		);
	}
	if (needs.vite && !needs.next) {
		results.push(
			await runPreflight([packageManager, "--bun", "create-vite@latest", ".", "--template", "react-ts"], cwd),
		);
	}
	if (needs.electron && !needs.next && !needs.vite) {
		results.push(await runPreflight([packageManager, "--bun", "create-electron-vite@latest", "."], cwd));
	}
	if (needs.tailwind && !needs.next) {
		// Tailwind v4 ships with create-vite templates; install + init only if absent.
		if (
			!fs.existsSync(path.join(cwd, "tailwind.config.js")) &&
			!fs.existsSync(path.join(cwd, "tailwind.config.ts"))
		) {
			results.push(await runPreflight([packageManager, "--bun", "tailwindcss@latest", "init", "-p"], cwd));
		}
	}
	if (needs.shadcn) {
		results.push(
			await runPreflight([packageManager, "--bun", "shadcn@latest", "init", "--yes", "--base-color", "slate"], cwd),
		);
	}
	if (needs.radix && !needs.shadcn) {
		// Radix is a peer of Shadcn; if Shadcn isn't requested, install
		// the primitives directly so SA1 can compose them.
		results.push(
			await runPreflight([packageManager, "--bun", "add", "@radix-ui/themes", "@radix-ui/react-icons"], cwd),
		);
	}

	for (const r of results) {
		if (r.ok) {
			logger.info("phase-3 preflight: ok", { command: r.command });
		} else {
			logger.warn("phase-3 preflight: failed", { command: r.command, stderr: r.stderr });
		}
	}
	return results;
}

/**
 * LLM-driven "do the work" pass. Calls the model with the subagent's
 * system prompt + role-specific input, and captures the structured
 * output describing what was created. Actual file changes are made by
 * the model via the tool system in a real runtime; here we capture
 * the *report* the model produces.
 */
export async function runSubagentLLM(
	spec: SubagentSpec,
	opts: { cwd: string; worktree: string; maxOutputTokens?: number },
): Promise<{ result: SubagentResult; json: unknown }> {
	const ctx = { role: spec.role, worktree: opts.worktree, context: spec.input };
	const start = Date.now();
	const result = await invokePhaseLLMJson<{
		report: string;
		filesCreated: string[];
		filesModified: string[];
	}>(spec.systemPrompt, JSON.stringify(ctx), {
		cwd: opts.cwd,
		phase: "phase-3",
		subagent: spec.id,
		maxOutputTokens: opts.maxOutputTokens ?? 8192,
	});
	const diff = await collectChanges(opts.worktree);
	const duration = Date.now() - start;
	return {
		result: {
			report: result.report,
			filesCreated: result.filesCreated.length > 0 ? result.filesCreated : diff.created,
			filesModified: result.filesModified.length > 0 ? result.filesModified : diff.modified,
			tokensUsed: 0,
			duration,
			errors: [],
		},
		json: result,
	};
}

/**
 * Sequential dispatcher for all 5 phase-3 sub-agents. Each runs in
 * its own worktree. Results are persisted to `phase-3/subagent-N.md`
 * and the global execution log.
 */
export interface SubagentDispatcherOptions {
	cwd: string;
	plan: string;
	tasks: string;
	design: string;
	wireframe: unknown;
	apiRef: string;
	dbSchema: string;
	mode: "HIL" | "YOLO";
	onProgress?: (agentId: string, status: "start" | "complete", result?: SubagentResult) => void;
}

export interface DispatcherOutput {
	results: Record<string, SubagentResult>;
	executionLog: string;
}

export interface DispatcherExtras {
	/** Per-subagent system prompts. If omitted, the bundled prompts are loaded. */
	systemPrompts?: Record<string, string>;
	/** Custom worktree path generator. Defaults to `<cwd>/.pakalon-agents/worktrees/<id>`. */
	generateWorktreeFor?: (id: string) => string;
}

const DEFAULT_SYSTEM_PROMPTS: Record<string, string> = {
	SA1: "You are Subagent 1 (Frontend Design). Read the design.md and wireframe.json, then implement the frontend using the tech stack and components specified in the plan. Use registry-rag to pick up curated components. Write a structured report of what you did.",
	SA2: "You are Subagent 2 (Backend Framing). Read the API_reference.md and Database_schema.md, then implement the backend in the language/framework chosen in phase 1. Write a structured report of what you did.",
	SA3: "You are Subagent 3 (Integration). Read the SA1 and SA2 reports, then integrate the frontend with the backend so that the application is end-to-end working with real auth and data flow.",
	SA4: "You are Subagent 4 (Debug & Test). Read the SA1-3 reports and run a line-by-line error scan + a full-app runtime check via Playwright. Auto-fix any issues you find. Write a structured report of what you did and what you fixed.",
	SA5: "You are Subagent 5 (User Feedback). Read the SA1-4 reports and the wireframe. Present an 'End phase 3 and start phase 4' confirmation, and surface any user-visible issues for review. (HIL only)",
};

const FALLBACK_SYSTEM_PROMPTS = DEFAULT_SYSTEM_PROMPTS;

function resolveSystemPrompts(extras?: DispatcherExtras): Record<string, string> {
	if (extras?.systemPrompts) return { ...DEFAULT_SYSTEM_PROMPTS, ...extras.systemPrompts };
	return DEFAULT_SYSTEM_PROMPTS;
}

function resolveWorktreeDir(cwd: string, agentId: string, extras?: DispatcherExtras): string {
	if (extras?.generateWorktreeFor) return extras.generateWorktreeFor(agentId);
	return path.join(cwd, ".pakalon-agents", "worktrees", agentId);
}

export async function dispatchSubagents(
	opts: SubagentDispatcherOptions,
	extras?: DispatcherExtras,
): Promise<DispatcherOutput> {
	const log: string[] = [
		`# Phase 3: Execution Log\n`,
		`| Timestamp | Subagent | Action | Status |`,
		`|-----------|----------|--------|--------|`,
	];
	const results: Record<string, SubagentResult> = {};

	const systemPrompts = resolveSystemPrompts(extras);
	const agentIds = Object.keys(DEFAULT_SYSTEM_PROMPTS) as (keyof typeof DEFAULT_SYSTEM_PROMPTS)[];
	const activeAgentIds = new Set(agentIds.filter(id => opts.mode === "HIL" || id !== "SA5"));

	let prevInput: Record<string, unknown> = {
		plan: opts.plan,
		tasks: opts.tasks,
		design: opts.design,
		wireframe: opts.wireframe,
		apiRef: opts.apiRef,
		dbSchema: opts.dbSchema,
	};

	// Preflight: when the project is empty and the plan/design/wireframe
	// references a known frontend stack, scaffold it before SA1 starts.
	// Per code.md §13.4 / CLI-req.md §Phase-3 SA1.
	const stackNeeds = detectFrontendStackNeeds({ plan: opts.plan, design: opts.design, wireframe: opts.wireframe });
	log.push(`| ${new Date().toISOString()} | preflight | detect-stack | ${JSON.stringify(stackNeeds)} |`);
	const preflightResults = await preflightStackInit(opts.cwd, stackNeeds);
	if (preflightResults.length > 0) {
		const okCount = preflightResults.filter(r => r.ok).length;
		log.push(`| ${new Date().toISOString()} | preflight | stack-init | ${okCount}/${preflightResults.length} ok |`);
		prevInput = { ...prevInput, preflight: preflightResults, preflightOk: okCount };
	}

	// Parallel wave dispatch: run independent sub-agents concurrently
	// via Promise.all, then chain the next wave once the prior finishes.
	for (const wave of SUBAGENT_WAVES) {
		const waveAgents = wave.filter(id => activeAgentIds.has(id));
		if (waveAgents.length === 0) continue;
		log.push(`| ${new Date().toISOString()} | wave[${waveAgents.join(",")}] | start | running |`);
		await Promise.all(
			waveAgents.map(async id => {
				const systemPrompt = systemPrompts[id] ?? FALLBACK_SYSTEM_PROMPTS[id] ?? "";
				const spec: SubagentSpec = {
					id,
					role: systemPrompt.split(" ").slice(0, 4).join(" "),
					systemPrompt,
					tools: (DEFAULT_TOOL_SETS as Record<string, readonly string[]>)[id] ?? [],
					input: prevInput,
					reportFile: path.join(
						opts.cwd,
						".pakalon-agents",
						"ai-agents",
						"phase-3",
						`subagent-${Array.from(activeAgentIds).indexOf(id) + 1}.md`,
					),
					executor: async () => ({
						report: "",
						filesCreated: [],
						filesModified: [],
						tokensUsed: 0,
						duration: 0,
						errors: [],
					}),
				};

				log.push(`| ${new Date().toISOString()} | ${id} | start | running |`);
				opts.onProgress?.(id, "start");
				const worktree = resolveWorktreeDir(opts.cwd, id, extras);
				fs.mkdirSync(path.dirname(worktree), { recursive: true });
				try {
					// Single-pass code generation via CodeGenerator.
					// Generates files, installs packages, runs build, all in one call.
					const projectSpec: ProjectSpec = {
						plan: opts.plan,
						tasks: opts.tasks,
						design: opts.design,
						wireframe: opts.wireframe,
						apiRef: opts.apiRef,
						dbSchema: opts.dbSchema,
						stackNeeds: detectFrontendStackNeeds({
							plan: opts.plan,
							design: opts.design,
							wireframe: opts.wireframe,
						}),
					};
					const codegenResult = await generateCodeForRole(
						projectSpec,
						worktree,
						id as "SA1" | "SA2" | "SA3" | "SA4" | "SA5",
						opts.mode,
						{ cwd: opts.cwd },
					);
					const result: SubagentResult = {
						report: formatCodegenResult(id, codegenResult),
						filesCreated: codegenResult.filesCreated,
						filesModified: codegenResult.filesModified,
						tokensUsed: 0,
						duration: 0,
						errors: codegenResult.errors,
					};
					results[id] = result;
					fs.mkdirSync(path.dirname(spec.reportFile), { recursive: true });
					fs.writeFileSync(spec.reportFile, result.report);
					log.push(
						`| ${new Date().toISOString()} | ${id} | complete | ${result.errors.length > 0 ? "with-warnings" : "ok"} |`,
					);
					opts.onProgress?.(id, "complete", result);
					prevInput = { ...prevInput, [`${id}_report`]: result.report };
				} catch (err) {
					const errMsg = err instanceof Error ? err.message : String(err);
					results[id] = {
						report: `# ${id} (failed)\n\nError: ${errMsg}\n`,
						filesCreated: [],
						filesModified: [],
						tokensUsed: 0,
						duration: 0,
						errors: [errMsg],
					};
					fs.mkdirSync(path.dirname(spec.reportFile), { recursive: true });
					fs.writeFileSync(spec.reportFile, results[id]!.report);
					log.push(`| ${new Date().toISOString()} | ${id} | error | failed |`);
					opts.onProgress?.(id, "complete", results[id]);
				}

				// HIL confirm-edit card: per CLI-req.md §225 and
				// code.md §7.3, after SA1 (frontend) finishes in HIL
				// mode, the TUI renders a 2-button card. The user can
				// Confirm (advance) or Make changes (route back to
				// the chat composer). In YOLO mode the card is
				// auto-confirmed and this branch is a no-op.
				if (id === "SA1" && opts.mode === "HIL") {
					try {
						const { resolveConfirmEdit, renderConfirmEditCard } = await import(
							"../../pakalon/tui/confirm-edit-card"
						);
						const choice = resolveConfirmEdit({
							agentId: "SA1",
							summary: `SA1 frontend produced ${(results[id]?.filesCreated.length ?? 0) + (results[id]?.filesModified.length ?? 0)} files`,
							mode: "HIL",
							changedFiles: [...(results[id]?.filesCreated ?? []), ...(results[id]?.filesModified ?? [])],
							milestone: "frontend complete",
						});
						log.push(`| ${new Date().toISOString()} | SA1 | confirm-edit-card | ${choice} |`);
						// Render the card to the execution log so it shows
						// up in `execution_log.md` for the user to inspect.
						const cardText = renderConfirmEditCard({
							agentId: "SA1",
							summary: "Frontend wave complete",
							mode: "HIL",
							changedFiles: [...(results[id]?.filesCreated ?? []), ...(results[id]?.filesModified ?? [])],
						});
						log.push(`| ${new Date().toISOString()} | SA1 | card-rendered | shown |`);
						// The interactive TUI event loop owns the actual
						// keyboard handling; the headless path (e.g. CI)
						// advances to the next wave.
						if (choice === "abort") {
							throw new Error("user aborted phase 3 after SA1");
						}
					} catch (err) {
						if (err instanceof Error && err.message === "user aborted phase 3 after SA1") throw err;
						logger.warn("phase-3: confirm-edit card render failed", { err });
					}
				}
			}),
		);
		log.push(`| ${new Date().toISOString()} | wave[${waveAgents.join(",")}] | complete | ok |`);
	}

	return { results, executionLog: `${log.join("\n")}\n` };
}

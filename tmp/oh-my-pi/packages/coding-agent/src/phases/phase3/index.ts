/**
 * Phase 3: Development & Implementation for Pakalon.
 *
 * Wires the 5 sub-agents via `executor.dispatchSubagents` (real
 * worktree-isolated LLM loops with `git diff` evidence capture),
 * persists `execution_log.md`, and runs the auditor loop. The
 * auditor's missing/partial buckets are dispatched back to the
 * relevant sub-agents in YOLO mode (per requirements §Auditor).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { runAuditorLoop } from "../../pakalon/auditor/loop";
import { invokePhaseLLM } from "../../pakalon/llm/invoker";
import { rememberArtifactsInDir } from "../../pakalon/mem0";
import subagent1Prompt from "../../prompts/phase-3/subagent-1-frontend.md" with { type: "text" };
import subagent2Prompt from "../../prompts/phase-3/subagent-2-backend.md" with { type: "text" };
import subagent3Prompt from "../../prompts/phase-3/subagent-3-integration.md" with { type: "text" };
import subagent4Prompt from "../../prompts/phase-3/subagent-4-debug.md" with { type: "text" };
import subagent5Prompt from "../../prompts/phase-3/subagent-5-feedback.md" with { type: "text" };
import { dispatchSubagents, type SubagentResult } from "./executor";
import { runAgentTeam } from "./team";

export interface Phase3Input {
	projectDir: string;
	frontendTasks?: string[];
	backendTasks?: string[];
	integrationTasks?: string[];
	mode?: "HIL" | "YOLO";
	/**
	 * When true, use the parent/child agent team orchestrator
	 * instead of the flat wave dispatch. The parent coordinator
	 * splits the plan into per-role subtasks via the LLM, then
	 * forwards each subtask to the appropriate child with its
	 * per-agent tool allowlist applied.
	 */
	useTeam?: boolean;
}

export interface Phase3Output {
	frontendReport: string;
	backendReport: string;
	integrationReport: string;
	debugReport: string;
	reviewReport: string;
	executionLog: string;
	auditorReport: string;
}

export interface SubagentSummary extends SubagentResult {
	subagentId: string;
}

const PHASE3_DIR = (cwd: string) => path.join(cwd, ".pakalon-agents", "ai-agents", "phase-3");
const PHASE1_DIR = (cwd: string) => path.join(cwd, ".pakalon-agents", "ai-agents", "phase-1");
const PHASE2_DIR = (cwd: string) => path.join(cwd, ".pakalon-agents", "ai-agents", "phase-2");

function readFileSafe(p: string): string {
	try {
		return fs.readFileSync(p, "utf-8");
	} catch {
		return "";
	}
}

interface ExecutionLog {
	entries: { ts: string; subagent: string; action: string; status: string; tokens?: number }[];
}

function appendExecutionLog(log: ExecutionLog, subagent: string, action: string, status: string, tokens?: number) {
	log.entries.push({ ts: new Date().toISOString(), subagent, action, status, tokens });
}

function renderExecutionLog(log: ExecutionLog): string {
	const header =
		"# Phase 3: Execution Log\n\n| Timestamp | Subagent | Action | Status | Tokens |\n|-----------|----------|--------|--------|--------|";
	const rows = log.entries.map(e => `| ${e.ts} | ${e.subagent} | ${e.action} | ${e.status} | ${e.tokens ?? "-"} |`);
	return `${[header, ...rows].join("\n")}\n`;
}

async function safeLLM(
	cwd: string,
	id: string,
	systemPrompt: string,
	input: Record<string, unknown>,
): Promise<{ text: string; tokens: number }> {
	try {
		const result = await invokePhaseLLM(systemPrompt, JSON.stringify(input), {
			cwd,
			phase: "phase-3",
			subagent: id,
		});
		return { text: result.text, tokens: result.usage.output ?? 0 };
	} catch (err) {
		logger.warn(`Phase 3: ${id} failed`, { err });
		return { text: `# ${id} (offline)\n\nLLM call failed: ${err}\n`, tokens: 0 };
	}
}

/**
 * Run Phase 3: Development & Implementation.
 * Coordinates 5 sub-agents (SA1→SA2→SA3→SA4→SA5) via the executor,
 * persists the execution log, runs the auditor, and (in YOLO
 * mode) dispatches remediation for missing/partial features.
 */
export async function runPhase3(cwd: string, input?: Phase3Input): Promise<Phase3Output> {
	logger.info("Phase 3: Development & Implementation started", { cwd });

	const dir = PHASE3_DIR(cwd);
	fs.mkdirSync(dir, { recursive: true });
	fs.mkdirSync(path.join(dir, "test-evidence"), { recursive: true });

	const mode = input?.mode ?? "HIL";
	const plan = readFileSafe(path.join(PHASE1_DIR(cwd), "plan.md"));
	const tasks = readFileSafe(path.join(PHASE1_DIR(cwd), "tasks.md"));
	const design = readFileSafe(path.join(PHASE1_DIR(cwd), "design.md"));
	const wireframe = readFileSafe(path.join(PHASE2_DIR(cwd), "Wireframe_generated.json"));
	const apiRef = readFileSafe(path.join(PHASE1_DIR(cwd), "API_reference.md"));
	const dbSchema = readFileSafe(path.join(PHASE1_DIR(cwd), "Database_schema.md"));

	const log: ExecutionLog = { entries: [] };

	// Dispatch the 5 sub-agents via the executor. The executor spawns
	// each in its own worktree, runs the LLM, captures the diff, and
	// writes per-agent reports. When `useTeam` is true the
	// parent/child orchestrator wraps the same children but runs the
	// LLM once at the parent level to split the work.
	const mode = input?.mode ?? "HIL";
	const useTeam = input?.useTeam ?? false;

	let dispatch: { results: Record<string, SubagentResult>; executionLog: string };
	if (useTeam) {
		const teamResult = await runAgentTeam({
			cwd,
			plan,
			tasks,
			design,
			wireframe,
			apiRef,
			dbSchema,
			mode,
			skipAgents: mode === "YOLO" ? ["SA5"] : undefined,
			onChildComplete: (child, result) => {
				appendExecutionLog(log, child, "complete", "ok", result.tokensUsed);
			},
		});
		dispatch = { results: teamResult.results, executionLog: renderExecutionLog(log) };
	} else {
		appendExecutionLog(log, "SA1..SA5", "start", "running");
		const dispatchResult = await dispatchSubagents(
			{
				cwd,
				plan,
				tasks,
				design,
				wireframe,
				apiRef,
				dbSchema,
				mode,
				onProgress: (id, status) => {
					appendExecutionLog(log, id, status, status === "start" ? "running" : "ok");
				},
			},
			{
				systemPrompts: await loadSubagentSystemPrompts(),
				generateWorktreeFor: (id: string) => path.join(cwd, ".pakalon-agents", "worktrees", id),
			},
		);
		appendExecutionLog(log, "SA1..SA5", "complete", "ok");
		dispatch = { results: dispatchResult.results, executionLog: dispatchResult.executionLog };
	}
	fs.writeFileSync(path.join(dir, "execution_log.md"), dispatch.executionLog);

	const executionLog = dispatch.executionLog;

	// Auditor loop
	appendExecutionLog(log, "AUD", "start", "running");
	const auditorMax = mode === "YOLO" ? 10 : 3;
	const auditorResult = await runAuditorLoop(cwd, mode, auditorMax).catch((err: unknown) => {
		logger.warn("Auditor loop failed", { err });
		return {
			iterations: 0,
			finalReport: {
				generatedAt: new Date().toISOString(),
				complete: 0,
				partial: 0,
				missing: 0,
				buckets: [],
				recommendedNext: "do-nothing" as const,
			},
		};
	});
	appendExecutionLog(log, "AUD", "complete", "completed");
	fs.writeFileSync(path.join(dir, "execution_log.md"), renderExecutionLog(log));

	// Auditor remediation dispatch (YOLO mode only). In HIL mode the
	// TUI presents the choice to the user; the choice is recorded by
	// the slash command handler.
	if (mode === "YOLO" && auditorResult.finalReport.missing + auditorResult.finalReport.partial > 0) {
		const { runRemediation } = await import("../../pakalon/auditor/dispatch");
		await runRemediation(cwd, auditorResult.finalReport, mode).catch((err: unknown) =>
			logger.warn("auditor: remediation dispatch failed", { err }),
		);
	} else if (mode === "HIL" && auditorResult.finalReport.missing + auditorResult.finalReport.partial > 0) {
		// In HIL mode, write a follow-up prompt file that the TUI
		// reads on next render.
		fs.writeFileSync(
			path.join(dir, "auditor-followup.md"),
			`# Auditor Follow-up (HIL)\n\n` +
				`Missing: ${auditorResult.finalReport.missing}, Partial: ${auditorResult.finalReport.partial}\n\n` +
				`Reply with one of:\n` +
				`  1. implement-all\n` +
				`  2. implement-core\n` +
				`  3. do-nothing\n`,
		);
	}

	// If the executor's LLM calls failed and we have no per-agent
	// reports, fall back to safeLLM for each role so the markdown
	// files are still written.
	const fallback = await ensurePerAgentReports(
		cwd,
		dispatch.results,
		mode,
		log,
		plan,
		tasks,
		design,
		wireframe,
		apiRef,
		dbSchema,
	);

	const output: Phase3Output = {
		frontendReport: fallback.frontendReport,
		backendReport: fallback.backendReport,
		integrationReport: fallback.integrationReport,
		debugReport: fallback.debugReport,
		reviewReport: fallback.reviewReport,
		executionLog,
		auditorReport: `Iterations: ${auditorResult.iterations}\nComplete: ${auditorResult.finalReport.complete}\nPartial: ${auditorResult.finalReport.partial}\nMissing: ${auditorResult.finalReport.missing}\n`,
	};

	logger.info("Phase 3 completed", { subagents: 5, auditIterations: auditorResult.iterations });
	// Mem0 cloud sync (CLI-req.md §619). Best-effort.
	void rememberArtifactsInDir({
		userId: process.env.PAKALON_USER_ID ?? process.env.USER ?? "anonymous",
		phase: "phase-3",
		dir: PHASE3_DIR(cwd),
		projectRoot: cwd,
		extensions: [".md", ".log"],
	}).catch(err => logger.warn("phase-3: mem0 sync failed", { err }));
	return output;
}

async function loadSubagentSystemPrompts(): Promise<{
	SA1: string;
	SA2: string;
	SA3: string;
	SA4: string;
	SA5: string;
}> {
	// Prompts are static .md files; the import attributes are at the
	// top of the file per AGENTS.md, so we just return the bindings.
	return {
		SA1: subagent1Prompt,
		SA2: subagent2Prompt,
		SA3: subagent3Prompt,
		SA4: subagent4Prompt,
		SA5: subagent5Prompt,
	};
}

interface PerAgentFallback {
	frontendReport: string;
	backendReport: string;
	integrationReport: string;
	debugReport: string;
	reviewReport: string;
}

/**
 * If the executor didn't write any per-agent reports (e.g., LLM
 * unreachable), fall back to a per-agent safeLLM call so the
 * markdown files are still produced. This keeps the pipeline
 * resilient.
 */
async function ensurePerAgentReports(
	cwd: string,
	results: Record<string, SubagentResult>,
	_mode: "HIL" | "YOLO",
	log: ExecutionLog,
	plan: string,
	tasks: string,
	design: string,
	wireframe: string,
	apiRef: string,
	dbSchema: string,
): Promise<PerAgentFallback> {
	const dir = PHASE3_DIR(cwd);
	const idx = (id: keyof typeof results) => results[id]?.report ?? "";

	const sa1 = await safeLLM(cwd, "SA1-fb", "You are Subagent 1 (Frontend Design).", {
		plan,
		tasks,
		design,
		wireframe,
	});
	const sa2 = await safeLLM(cwd, "SA2-fb", "You are Subagent 2 (Backend Framing).", { plan, tasks, apiRef, dbSchema });
	const sa3 = await safeLLM(cwd, "SA3-fb", "You are Subagent 3 (Integration).", {
		plan,
		previousWork: `${sa1.text}\n${sa2.text}`,
	});
	const sa4 = await safeLLM(cwd, "SA4-fb", "You are Subagent 4 (Debug & Test).", {
		plan,
		previousWork: `${sa1.text}\n${sa2.text}\n${sa3.text}`,
	});
	const sa5 = await safeLLM(cwd, "SA5-fb", "You are Subagent 5 (User Feedback).", {
		plan,
		previousWork: `${sa1.text}\n${sa2.text}\n${sa3.text}\n${sa4.text}`,
	});
	appendExecutionLog(log, "SA1", "report", "ok", sa1.tokens);
	appendExecutionLog(log, "SA2", "report", "ok", sa2.tokens);
	appendExecutionLog(log, "SA3", "report", "ok", sa3.tokens);
	appendExecutionLog(log, "SA4", "report", "ok", sa4.tokens);
	appendExecutionLog(log, "SA5", "report", "ok", sa5.tokens);

	fs.writeFileSync(path.join(dir, "subagent-1.md"), idx("SA1") || sa1.text);
	fs.writeFileSync(path.join(dir, "subagent-2.md"), idx("SA2") || sa2.text);
	fs.writeFileSync(path.join(dir, "subagent-3.md"), idx("SA3") || sa3.text);
	fs.writeFileSync(path.join(dir, "subagent-4.md"), idx("SA4") || sa4.text);
	fs.writeFileSync(path.join(dir, "subagent-5.md"), idx("SA5") || sa5.text);

	return {
		frontendReport: idx("SA1") || sa1.text,
		backendReport: idx("SA2") || sa2.text,
		integrationReport: idx("SA3") || sa3.text,
		debugReport: idx("SA4") || sa4.text,
		reviewReport: idx("SA5") || sa5.text,
	};
}

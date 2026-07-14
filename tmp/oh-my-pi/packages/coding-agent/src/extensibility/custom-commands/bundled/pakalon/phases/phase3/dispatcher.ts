/**
 * Phase 3: 5-subagent dispatcher.
 *
 * Reads the Phase 1 + Phase 2 outputs, plans the work into 5 sequential
 * subagent slots (frontend, backend, integration, debug, review), and
 * runs each one as a `task` subagent. The actual LLM prompts live in
 * `prompts/phase-3/subagent-{1..5}.md`; this module is the orchestrator.
 *
 * The auditor loop is not part of this dispatcher — it runs in a
 * separate graph node after Phase 3 completes.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

export type SubagentRole = "frontend" | "backend" | "integration" | "debug" | "review";

export interface SubagentTask {
	role: SubagentRole;
	reads: string[]; // files the subagent should consult
	writes: string[]; // files the subagent owns
	promptFile: string; // static prompt under prompts/phase-3/
}

export const PHASE3_TASKS: readonly SubagentTask[] = [
	{
		role: "frontend",
		reads: [
			"phase-1/plan.md",
			"phase-1/design.md",
			"phase-2/Wireframe_generated.svg",
			"phase-2/Wireframe_generated.json",
		],
		writes: ["frontend/**", "phase-3/subagent-1.md"],
		promptFile: "phase-3/subagent-1.md",
	},
	{
		role: "backend",
		reads: ["phase-3/subagent-1.md", "phase-1/API_reference.md", "phase-1/Database_schema.md"],
		writes: ["backend/**", "phase-3/subagent-2.md"],
		promptFile: "phase-3/subagent-2.md",
	},
	{
		role: "integration",
		reads: ["phase-3/subagent-1.md", "phase-3/subagent-2.md"],
		writes: ["frontend/**", "backend/**", "phase-3/subagent-3.md"],
		promptFile: "phase-3/subagent-3.md",
	},
	{
		role: "debug",
		reads: ["phase-3/subagent-1.md", "phase-3/subagent-2.md", "phase-3/subagent-3.md"],
		writes: ["phase-3/subagent-4.md", "**/fixes/**"],
		promptFile: "phase-3/subagent-4.md",
	},
	{
		role: "review",
		reads: ["phase-3/subagent-1.md", "phase-3/subagent-2.md", "phase-3/subagent-3.md", "phase-3/subagent-4.md"],
		writes: ["phase-3/subagent-5.md"],
		promptFile: "phase-3/subagent-5.md",
	},
] as const;

export interface Phase3Context {
	projectDir: string;
	mode: "HIL" | "YOLO";
}

/**
 * Returns the next subagent task based on the current Phase 3 state.
 * Reads the existing subagent-N.md files to determine which have
 * completed; the first one that hasn't starts (or HIL confirms).
 */
export function nextSubagent(ctx: Phase3Context): SubagentTask | null {
	const phase3 = path.join(ctx.projectDir, ".pakalon-agents", "ai-agents", "phase-3");
	for (const task of PHASE3_TASKS) {
		const reportPath = path.join(phase3, `subagent-${taskIndex(task.role)}.md`);
		try {
			const md = fs.readFileSync(reportPath, "utf-8");
			// Heuristic: a subagent is "done" when its report ends with the
			// completion marker. Real implementations inspect structured fields.
			if (md.includes("Status: completed") || md.includes("Status:** completed")) {
				continue;
			}
			return task;
		} catch {
			return task; // not yet written → start it
		}
	}
	return null;
}

function taskIndex(role: SubagentRole): number {
	const map: Record<SubagentRole, number> = {
		frontend: 1,
		backend: 2,
		integration: 3,
		debug: 4,
		review: 5,
	};
	return map[role];
}

/**
 * Append a row to the execution log.
 */
export function logExecution(
	ctx: Phase3Context,
	role: SubagentRole,
	status: "started" | "completed" | "failed",
	note: string,
): void {
	const logPath = path.join(ctx.projectDir, ".pakalon-agents", "ai-agents", "phase-3", "execution_log.md");
	fs.mkdirSync(path.dirname(logPath), { recursive: true });
	const ts = new Date().toISOString();
	const line = `| ${ts} | ${role} | ${status} | ${note} |\n`;
	fs.appendFileSync(logPath, line, "utf-8");
	logger.info("phase 3 subagent", { role, status, note });
}

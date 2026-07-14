/**
 * Auditor agent loop for Pakalon Phase 3.
 * Read-only: compares the generated codebase against the phase-1 plan
 * and writes `auditor.md` with buckets (fully / partially / missing).
 * In HIL mode, presents the user with a 3-option follow-up; in YOLO
 * mode, auto-dispatches to the relevant sub-agent.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { invokePhaseLLMJson } from "../llm/invoker";

const PHASE1_DIR = (cwd: string) => path.join(cwd, ".pakalon-agents", "ai-agents", "phase-1");
const PHASE3_DIR = (cwd: string) => path.join(cwd, ".pakalon-agents", "ai-agents", "phase-3");

export interface AuditBucket {
	feature: string;
	status: "complete" | "partial" | "missing";
	notes?: string;
	evidence?: string[];
}

export interface AuditReport {
	generatedAt: string;
	complete: number;
	partial: number;
	missing: number;
	buckets: AuditBucket[];
	recommendedNext: "remediate-all" | "core-only" | "do-nothing";
}

/** Read the phase-1 plan + tasks for comparison. */
function readPlan(cwd: string): { plan: string; tasks: string; userStories: string } {
	const p1 = PHASE1_DIR(cwd);
	return {
		plan: safeRead(path.join(p1, "plan.md")),
		tasks: safeRead(path.join(p1, "tasks.md")),
		userStories: safeRead(path.join(p1, "user-stories.md")),
	};
}

function safeRead(p: string): string {
	try {
		return fs.readFileSync(p, "utf-8");
	} catch {
		return "";
	}
}

/** Read the codebase: every file under the project (excluding generated dirs). */
function readCodebase(cwd: string): string {
	const out: string[] = [];
	const skip = new Set(["node_modules", ".git", "dist", "build", ".next", ".turbo", ".pakalon-agents"]);
	function walk(dir: string, depth: number) {
		if (depth > 4) return; // cap recursion to keep prompt manageable
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (skip.has(e.name)) continue;
			if (e.name.startsWith(".") && e.name !== ".env.example") continue;
			const p = path.join(dir, e.name);
			if (e.isDirectory()) walk(p, depth + 1);
			else if (e.isFile() && /\.(ts|tsx|js|jsx|go|rs|py|java|rb)$/i.test(e.name)) {
				try {
					const content = fs.readFileSync(p, "utf-8");
					out.push(`// FILE: ${path.relative(cwd, p)}\n${content.slice(0, 2000)}`);
				} catch {
					/* ignore */
				}
			}
		}
	}
	walk(cwd, 0);
	return out.join("\n\n").slice(0, 80_000); // hard cap
}

/** Run one auditor pass and return the structured report. */
export async function runAuditorPass(cwd: string, mode: "HIL" | "YOLO"): Promise<AuditReport> {
	const { plan, tasks, userStories } = readPlan(cwd);
	const codebase = readCodebase(cwd);

	const result = await invokePhaseLLMJson<{
		buckets: AuditBucket[];
		recommendedNext: AuditReport["recommendedNext"];
	}>(
		"You are a strict read-only auditor. Compare the codebase against the plan + user stories. Bucket every feature as complete / partial / missing. Do NOT modify any file. Output JSON only.",
		JSON.stringify({ plan, tasks, userStories, codebase, mode }),
		{ cwd, phase: "phase-3", subagent: "auditor" },
	);

	const complete = result.buckets.filter(b => b.status === "complete").length;
	const partial = result.buckets.filter(b => b.status === "partial").length;
	const missing = result.buckets.filter(b => b.status === "missing").length;

	return {
		generatedAt: new Date().toISOString(),
		complete,
		partial,
		missing,
		buckets: result.buckets,
		recommendedNext: mode === "YOLO" ? "remediate-all" : result.recommendedNext,
	};
}

/** Run the auditor loop. Writes `auditor.md` after each pass. */
export async function runAuditorLoop(
	cwd: string,
	mode: "HIL" | "YOLO",
	maxIterations: number,
): Promise<{ iterations: number; finalReport: AuditReport }> {
	const limit = computeIterationLimit(mode, maxIterations);
	return runAuditorLoopWith(cwd, mode, limit, runAuditorPass);
}

/** Compute the iteration limit for a given mode + user-supplied max. */
export function computeIterationLimit(mode: "HIL" | "YOLO", maxIterations: number): number {
	// YOLO mode is capped at 10 iterations (per the requirement: "for
	// YOLO mode it is maximum of 10 times this happens in loop"). HIL
	// uses the user-supplied max (e.g. 3 by default).
	return mode === "YOLO" ? Math.min(maxIterations, 10) : Math.max(1, maxIterations);
}

/**
 * Generic loop runner. Exported for tests so we can pass a fake
 * `runPass` that doesn't require an LLM.
 */
export async function runAuditorLoopWith(
	cwd: string,
	mode: "HIL" | "YOLO",
	limit: number,
	runPass: (cwd: string, mode: "HIL" | "YOLO") => Promise<AuditReport>,
): Promise<{ iterations: number; finalReport: AuditReport }> {
	let iterations = 0;
	let finalReport: AuditReport = {
		generatedAt: new Date().toISOString(),
		complete: 0,
		partial: 0,
		missing: 0,
		buckets: [],
		recommendedNext: "do-nothing",
	};
	for (let i = 0; i < limit; i++) {
		iterations++;
		const report = await runPass(cwd, mode);
		writeAuditorMd(cwd, report, i);
		finalReport = report;
		const total = report.complete + report.partial + report.missing;
		const pct = total > 0 ? Math.round((report.complete / total) * 100) : 100;
		logger.info(`auditor: pass ${iterations}/${limit} — ${pct}% complete (${report.complete}/${total})`);
		// 100% pass exit: everything in the plan is fully implemented.
		if (report.missing === 0 && report.partial === 0) {
			logger.info("auditor: 100% — stopping loop (100% pass exit)", { iterations });
			break;
		}
		// HIL: respect the user's "do nothing" choice.
		if (mode === "HIL" && report.recommendedNext === "do-nothing") break;
	}
	return { iterations, finalReport };
}

/** Render the report as markdown and write it to `phase-3/auditor.md`. */
export function writeAuditorMd(cwd: string, report: AuditReport, version: number): void {
	const dir = PHASE3_DIR(cwd);
	fs.mkdirSync(dir, { recursive: true });
	const total = report.complete + report.partial + report.missing;
	const pct = total > 0 ? Math.round((report.complete / total) * 100) : 0;
	const lines: string[] = [
		`# Auditor Report (v${version + 1})`,
		`Generated: ${report.generatedAt}`,
		"",
		`## Summary`,
		`- Complete: **${report.complete}** (${pct}%)`,
		`- Partial: ${report.partial}`,
		`- Missing: ${report.missing}`,
		`- Recommended next: \`${report.recommendedNext}\``,
		"",
		"## Buckets",
		"",
		"| Feature | Status | Notes |",
		"| --- | --- | --- |",
	];
	for (const b of report.buckets) {
		lines.push(`| ${b.feature} | ${b.status} | ${b.notes ?? ""} |`);
	}
	fs.writeFileSync(path.join(dir, "auditor.md"), lines.join("\n"));
}

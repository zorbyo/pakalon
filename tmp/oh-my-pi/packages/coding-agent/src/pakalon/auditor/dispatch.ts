/**
 * Auditor dispatch — when the Auditor's `recommendedNext` is
 * "remediate-all" or "core-only", this module dispatches the
 * missing-feature buckets to the relevant Phase-3 sub-agents via
 * the existing `task/` subagent system. Used by `phases/phase3` and
 * the `/auditor` slash command.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import type { SubagentResult } from "../../phases/phase3/executor";
import { DEFAULT_TOOL_SETS, runSubagentLLM } from "../../phases/phase3/executor";
import type { AuditReport } from "./loop";

const REMEDIATION_PROMPTS: Record<string, string> = {
	frontend:
		"You are Subagent 1 (Frontend Design). Fix the missing/partial features listed in the auditor's report. Focus on the frontend, UI, and styling.",
	backend:
		"You are Subagent 2 (Backend Framing). Fix the missing/partial features listed in the auditor's report. Focus on the backend, API routes, and data layer.",
	integration:
		"You are Subagent 3 (Integration). Fix the missing/partial integration points. Wire the missing frontend features to the backend.",
	debug: "You are Subagent 4 (Debug & Test). Fix the bugs and missing test coverage identified in the auditor's report.",
	review:
		"You are Subagent 5 (User Feedback). Re-review the application and surface any remaining user-visible issues.",
};

export interface DispatchPlan {
	missing: AuditReport["buckets"];
	target: Record<string, AuditReport["buckets"]>;
	recommended: keyof typeof REMEDIATION_PROMPTS;
}

const KEYWORD_MAP: Array<[RegExp, keyof typeof REMEDIATION_PROMPTS]> = [
	[/frontend|ui|ux|component|page|button|form|css|tailwind/i, "frontend"],
	[/backend|api|route|endpoint|controller|middleware|database|schema|migration/i, "backend"],
	[/integration|wire|connect|api call|fetch/i, "integration"],
	[/test|bug|fix|debug|error|exception|crash|playwright|smoke/i, "debug"],
	[/review|feedback|ux|usability|preview/i, "review"],
];

/**
 * Classify a missing-feature bucket into the most likely sub-agent
 * owner. Falls back to "frontend" if no keyword matches.
 */
export function classifyBucket(bucket: string): keyof typeof REMEDIATION_PROMPTS {
	for (const [re, key] of KEYWORD_MAP) {
		if (re.test(bucket)) return key;
	}
	return "frontend";
}

/**
 * Plan the remediation: group buckets by owner, surface the
 * recommended first step.
 */
export function planDispatch(report: AuditReport, _mode: "HIL" | "YOLO"): DispatchPlan {
	const missing = report.buckets.filter(b => b.status === "missing" || b.status === "partial");
	const target: Record<string, AuditReport["buckets"]> = {};
	for (const b of missing) {
		const owner = classifyBucket(b.feature);
		if (!target[owner]) target[owner] = [];
		target[owner]!.push(b);
	}
	const counts = Object.entries(target).map(([k, v]) => ({ k: k as keyof typeof REMEDIATION_PROMPTS, n: v.length }));
	counts.sort((a, b) => b.n - a.n);
	return { missing, target, recommended: counts[0]?.k ?? "frontend" };
}

/**
 * Execute the dispatch: spawn the relevant sub-agents in their
 * worktrees and persist a per-agent remediation report.
 */
export interface DispatchResult {
	plan: DispatchPlan;
	results: Record<string, SubagentResult>;
}

export async function runRemediation(cwd: string, report: AuditReport, mode: "HIL" | "YOLO"): Promise<DispatchResult> {
	const plan = planDispatch(report, mode);
	if (plan.missing.length === 0) {
		logger.info("auditor: no missing features to remediate");
		return { plan, results: {} };
	}
	const results: Record<string, SubagentResult> = {};
	const dir = path.join(cwd, ".pakalon-agents", "ai-agents", "phase-3");
	fs.mkdirSync(dir, { recursive: true });
	for (const [owner, buckets] of Object.entries(plan.target)) {
		const subagentPrompt = REMEDIATION_PROMPTS[owner]!;
		const systemPrompt = `${subagentPrompt}\n\nThe auditor has identified the following missing/partial features to remediate:\n${buckets.map(b => `- ${b.feature} (${b.status}): ${b.notes ?? ""}`).join("\n")}\n\nApply the fixes to the codebase. Run any relevant tools. Then write a structured report.`;
		const tools =
			DEFAULT_TOOL_SETS[
				owner === "review"
					? "SA5"
					: owner === "debug"
						? "SA4"
						: owner === "integration"
							? "SA3"
							: owner === "backend"
								? "SA2"
								: "SA1"
			];
		const worktree = path.join(cwd, ".pakalon-agents", "worktrees", `audit-${owner}`);
		fs.mkdirSync(path.dirname(worktree), { recursive: true });
		try {
			const spec = {
				id: `AUDIT-${owner.toUpperCase()}`,
				role: `Remediate ${owner}`,
				systemPrompt,
				tools,
				input: { buckets, plan, mode },
				reportFile: path.join(dir, `audit-remediation-${owner}.md`),
				executor: async () => ({
					report: "",
					filesCreated: [],
					filesModified: [],
					tokensUsed: 0,
					duration: 0,
					errors: [],
				}),
			};
			const { result } = await runSubagentLLM(spec, { cwd, worktree });
			results[owner] = result;
			fs.writeFileSync(spec.reportFile, result.report);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			results[owner] = {
				report: `# ${owner} remediation failed: ${msg}\n`,
				filesCreated: [],
				filesModified: [],
				tokensUsed: 0,
				duration: 0,
				errors: [msg],
			};
		}
	}
	return { plan, results };
}

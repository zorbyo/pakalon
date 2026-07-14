/**
 * Phase 4: Testing & Security QA for Pakalon.
 *
 * Wires the 5 sub-agents (SAST, DAST, code review, CI/CD, pentest)
 * via `tools.ts: runTool / runToolsByKind / runHoppscotch` (real
 * Docker-orchestrated tool runs), persists whitebox/blackbox XML,
 * and writes the per-agent reports. Tools are tier-gated (free
 * users only see free-tier tools).
 *
 * Auto-remediation loop (CLI-req.md §329):
 *   "This loop can repeat (Phase 3 → Phase 4) until the user accepts
 *    results". When `input?.autoRemediate === true` and critical
 *    vulnerabilities are found, phase-4 re-invokes phase-3 to patch
 *    and re-test, bounded by `input?.maxRemediationIterations`
 *    (default 3).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { getUserTier } from "../../auth/openrouter-auth";
import { invokePhaseLLM } from "../../pakalon/llm/invoker";
import { rememberArtifactsInDir } from "../../pakalon/mem0";
import {
	canPromoteFromSandbox,
	computeReviewScore,
	exitSandbox,
	markSandboxEligible,
} from "../../pakalon/sandbox/policy";
import {
	runChromeDevToolsTest,
	runDeepScan,
	runHoppscotch,
	runTool,
	runToolsByKind,
	TOOL_REGISTRY,
	type ToolKind,
	type ToolRunResult,
	type ToolSpec,
	toolsForTier,
	waitForApp,
} from "./tools";

const PHASE4_DIR = (cwd: string) => path.join(cwd, ".pakalon-agents", "ai-agents", "phase-4");
const PHASE4_OVERRIDE_FILE = (cwd: string) => path.join(PHASE4_DIR(cwd), "phase-4-override.json");

function readFileSafe(p: string): string {
	try {
		return fs.readFileSync(p, "utf-8");
	} catch {
		return "";
	}
}

export interface Phase4Input {
	projectDir: string;
	enableSast: boolean;
	enableDast: boolean;
	enableCodeReview: boolean;
	/** Optional dev-server target URL. If omitted, DAST tools skip with a "no-target" status. */
	devServerTarget?: string;
	/** Whether to actually run Docker tools (default: true). Pass false to skip. */
	runTools?: boolean;
	/**
	 * When true, phase-4 will automatically re-invoke phase-3 to remediate
	 * critical/high vulnerabilities (per CLI-req.md §329). Default: false.
	 */
	autoRemediate?: boolean;
	/** Maximum remediation iterations when autoRemediate is enabled. Default: 3. */
	maxRemediationIterations?: number;
	/** Mode for phase-3 re-invocation. Default: "YOLO" (since loop is autonomous). */
	remediationMode?: "HIL" | "YOLO";
	/**
	 * Mode for the overall Phase 4 run. When "HIL", the user is prompted
	 * if critical/high findings persist after auto-remediation (CLI-req.md
	 * §337 "proceed despite warnings"). Default: undefined (legacy — no
	 * override prompt, backward compatible).
	 */
	mode?: "HIL" | "YOLO";
	/**
	 * When true, skip the override prompt even in HIL mode. Used when the
	 * user has already chosen "proceed despite warnings".
	 */
	userOverrideProceed?: boolean;
}

export interface Phase4Output {
	sastReport: string;
	dastReport: string;
	codeReviewReport: string;
	cicdReport: string;
	securityReport: string;
	whiteboxTesting: string;
	blackboxTesting: string;
	toolResults: ToolRunResult[];
	/**
	 * Severity rollup used by the auto-remediation loop. Counters are
	 * computed by `summariseSeverity()` from `ToolRunResult.parsed`.
	 */
	severitySummary?: { critical: number; high: number; medium: number; low: number };
	/** Number of times phase-3 was re-invoked. */
	remediationIterations?: number;
}

const SECURITY_PROMPTS: Record<string, string> = {
	"subagent-1-sast":
		"You are Subagent 1 (SAST). Run the SAST tools and summarise findings. List every tool, its exit code, the number of findings, and the top 5 by severity. Reference each finding with file:line when possible.",
	"subagent-2-dast":
		"You are Subagent 2 (DAST). Run the DAST tools against the dev server and summarise findings. If the dev server is not running, note that and provide the commands the user should run.",
	"subagent-3-code-review":
		"You are Subagent 3 (Code Review). Read the project source, flag issues (style, correctness, performance, security), and write a structured report. Use ast-grep and grep to find anti-patterns.",
	"subagent-4-cicd":
		"You are Subagent 4 (CI/CD). Inspect the existing pipeline (or absence of one) and propose a recommended GitHub Actions / GitLab CI / Buildkite / etc. config. If a config exists, identify anti-patterns and suggest fixes.",
	"subagent-5-pentest":
		"You are Subagent 5 (Pentest). Read the project source and run targeted security probes (SQLi/CSRF/XSS/IDOR/auth/DoS vectors). Summarise findings with severity buckets. Reference the SAST/DAST results when available.",
};

/**
 * Run Phase 4: Testing & Security QA.
 * Runs each security tool, then writes per-agent reports that
 * summarise the tool results + the LLM's analysis.
 */
export async function runPhase4(cwd: string, input?: Phase4Input): Promise<Phase4Output> {
	logger.info("Phase 4: Testing & Security QA started", { cwd });

	const dir = PHASE4_DIR(cwd);
	fs.mkdirSync(dir, { recursive: true });

	const plan = readFileSafe(path.join(cwd, ".pakalon-agents", "ai-agents", "phase-1", "plan.md"));
	const tasks = readFileSafe(path.join(cwd, ".pakalon-agents", "ai-agents", "phase-1", "tasks.md"));
	const userStories = readFileSafe(path.join(cwd, ".pakalon-agents", "ai-agents", "phase-1", "user-stories.md"));

	const runTools = input?.runTools !== false;
	const devServerTarget = input?.devServerTarget ?? process.env.PAKALON_DEV_SERVER;
	const tier = getUserTier() === "pro" ? "pro" : "free";
	const enabledTools = toolsForTier(tier);

	// Run the security tools. Each tool's exit code + parsed JSON
	// are captured. We collect everything into toolResults so the
	// downstream LLM summarisation can reference them.
	const toolResults: ToolRunResult[] = [];
	if (runTools) {
		if (input?.enableSast) {
			toolResults.push(...(await runToolsByKind("sast", cwd)));
		}
		if (input?.enableDast) {
			// DAST needs a running dev server. Wait for it (with a
			// short grace period) before invoking the tools.
			if (devServerTarget) {
				const ready = await waitForApp(devServerTarget, 15_000);
				if (ready) {
					toolResults.push(...(await runToolsByKind("dast", cwd, devServerTarget)));
				} else {
					logger.warn("dev server not ready, DAST tools skipped", { devServerTarget });
				}
			} else {
				// No target → DAST tools skip with a clear "no-target" reason.
				for (const t of enabledTools.filter(x => x.kind === "dast")) {
					toolResults.push(await runTool(t, cwd));
				}
			}
		}
		// Hoppscotch is pro-only and runs against the dev server.
		if (input?.enableDast && devServerTarget) {
			toolResults.push(await runHoppscotch(cwd, devServerTarget));
		}

		// Deep security scan (pattern-based, no Docker needed)
		toolResults.push(await runDeepScan(cwd));

		// Chrome DevTools testing (if Chrome is running with CDP)
		if (devServerTarget) {
			toolResults.push(await runChromeDevToolsTest(cwd, devServerTarget));
		}
	}

	// Per-agent LLM summarisation. Each sub-agent receives the tool
	// results + the plan and writes its own report.
	const sastResults = toolResults.filter(r => r.kind === "sast");
	const dastResults = toolResults.filter(r => r.kind === "dast" || r.kind === "hoppscotch");
	const sastReport = await writeAgentReport(cwd, "subagent-1.md", SECURITY_PROMPTS["subagent-1-sast"]!, {
		plan,
		tasks,
		results: sastResults,
	});
	const dastReport = await writeAgentReport(cwd, "subagent-2.md", SECURITY_PROMPTS["subagent-2-dast"]!, {
		plan,
		tasks,
		results: dastResults,
	});
	const codeReviewReport = await writeAgentReport(cwd, "subagent-3.md", SECURITY_PROMPTS["subagent-3-code-review"]!, {
		plan,
		tasks,
	});
	const cicdReport = await writeAgentReport(cwd, "subagent-4.md", SECURITY_PROMPTS["subagent-4-cicd"]!, {
		plan,
		tasks,
	});
	const securityReport = await writeAgentReport(cwd, "subagent-5.md", SECURITY_PROMPTS["subagent-5-pentest"]!, {
		plan,
		tasks,
		results: toolResults,
	});

	// Whitebox + blackbox XML
	const whiteboxTesting = generateWhiteboxXML(plan, userStories);
	const blackboxTesting = generateBlackboxXML(userStories);

	fs.writeFileSync(path.join(dir, "whitebox_testing.xml"), whiteboxTesting);
	fs.writeFileSync(path.join(dir, "blackbox_testing.xml"), blackboxTesting);

	// Severity rollup + auto-remediation loop (CLI-req.md §329).
	const severitySummary = summariseSeverity(toolResults);
	let remediationIterations = 0;
	if (input?.autoRemediate && severitySummary.critical + severitySummary.high > 0) {
		remediationIterations = await runRemediationLoop({
			cwd,
			maxIterations: input.maxRemediationIterations ?? 3,
			mode: input.remediationMode ?? "YOLO",
			currentSeverity: severitySummary,
		});
	}

	// Sandbox auto-teardown (CLI-req.md §716): "after the phase-4 review
	// scores are more than the eligible critera only the sandboxing can
	// stop and the code can be used on the actual env".
	const reviewScore = computeReviewScore(
		severitySummary.critical + severitySummary.high,
		severitySummary.medium + severitySummary.low,
	);
	markSandboxEligible(reviewScore);
	let sandboxTornDown = false;
	if (canPromoteFromSandbox(reviewScore)) {
		try {
			await exitSandbox();
			sandboxTornDown = true;
			logger.info("phase-4: sandbox torn down (review score passed)", { score: reviewScore });
		} catch (err) {
			logger.warn("phase-4: sandbox teardown failed", { err });
		}
	}

	// phase-4.md summary always ends with a Call-back block so manual
	// mode shows the same instructions.
	const phase4Summary = renderPhase4Summary({
		severitySummary,
		remediationIterations,
		autoRemediate: input?.autoRemediate ?? false,
		reviewScore,
		sandboxTornDown,
	});
	fs.writeFileSync(path.join(dir, "phase-4.md"), phase4Summary);

	// HIL override prompt (CLI-req.md §337). If critical/high findings
	// remain after auto-remediation and the user hasn't already chosen
	// "proceed despite warnings", write the override file for the caller.
	const needsUserOverride =
		input?.mode === "HIL" && !input?.userOverrideProceed && severitySummary.critical + severitySummary.high > 0;

	if (needsUserOverride) {
		writePhase4Override(cwd, severitySummary, remediationIterations);
		logger.info("phase-4: wrote override prompt (critical/high remain)");
	}

	logger.info("Phase 4 completed", {
		toolResults: toolResults.length,
		reports: 5,
		severity: severitySummary,
		remediationIterations,
		needsUserOverride,
	});
	// Mem0 cloud sync (CLI-req.md §619). Best-effort.
	void rememberArtifactsInDir({
		userId: process.env.PAKALON_USER_ID ?? process.env.USER ?? "anonymous",
		phase: "phase-4",
		dir: PHASE4_DIR(cwd),
		projectRoot: cwd,
		extensions: [".md", ".xml"],
	}).catch(err => logger.warn("phase-4: mem0 sync failed", { err }));
	return {
		sastReport,
		dastReport,
		codeReviewReport,
		cicdReport,
		securityReport,
		whiteboxTesting,
		blackboxTesting,
		toolResults,
		severitySummary,
		remediationIterations,
	};
}

/**
 * Walk `ToolRunResult.parsed` looking for severity buckets. Each tool
 * (semgrep, bandit, owasp-zap, ...) emits a slightly different shape, so
 * we apply a permissive scan: any `{ severity, level, priority, ... }` key
 * that resolves to `critical|high|medium|low` counts toward the bucket.
 */
function summariseSeverity(results: ToolRunResult[]): { critical: number; high: number; medium: number; low: number } {
	const counts = { critical: 0, high: 0, medium: 0, low: 0 };
	const bump = (raw: unknown): void => {
		const s = String(raw ?? "")
			.toLowerCase()
			.trim();
		if (s === "critical" || s === "blocker") counts.critical += 1;
		else if (s === "high" || s === "error") counts.high += 1;
		else if (s === "medium" || s === "warning" || s === "warn") counts.medium += 1;
		else if (s === "low" || s === "info" || s === "note") counts.low += 1;
	};
	const visit = (node: unknown): void => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const item of node) visit(item);
			return;
		}
		const obj = node as Record<string, unknown>;
		for (const key of ["severity", "level", "priority", "risk", "impact"]) {
			if (key in obj) bump(obj[key]);
		}
		for (const v of Object.values(obj)) {
			if (v && typeof v === "object") visit(v);
		}
	};
	for (const r of results) {
		if (r.parsed) visit(r.parsed);
	}
	return counts;
}

/**
 * Re-invoke phase-3 to remediate critical/high findings, then re-run
 * phase-4. Bounded by `maxIterations` to avoid infinite loops.
 */
async function runRemediationLoop(opts: {
	cwd: string;
	maxIterations: number;
	mode: "HIL" | "YOLO";
	currentSeverity: { critical: number; high: number; medium: number; low: number };
}): Promise<number> {
	let iterations = 0;
	let lastSeverity = opts.currentSeverity;
	const max = Math.max(0, Math.min(opts.maxIterations, 10));
	while (iterations < max && lastSeverity.critical + lastSeverity.high > 0) {
		iterations += 1;
		logger.info("phase-4: auto-remediation iteration", { iteration: iterations, severity: lastSeverity });
		try {
			const { runPhase3 } = await import("../phase3/index");
			await runPhase3(opts.cwd, { mode: opts.mode, projectDir: opts.cwd });
			// Re-test the same tool set inline (best-effort; full re-test
			// would re-read plan/user-stories from disk, so we just
			// delegate back to phase-4 via a separate call here).
			const { runPhase4 } = await import("./index");
			const retest = await runPhase4(opts.cwd, {
				projectDir: opts.cwd,
				enableSast: true,
				enableDast: false,
				enableCodeReview: true,
				runTools: true,
				autoRemediate: false, // prevent recursion
			});
			lastSeverity = retest.severitySummary ?? { critical: 0, high: 0, medium: 0, low: 0 };
		} catch (err) {
			logger.warn("phase-4: remediation iteration failed", { iteration: iterations, err });
			break;
		}
	}
	if (lastSeverity.critical + lastSeverity.high > 0) {
		logger.warn("phase-4: auto-remediation exhausted with critical/high findings", {
			iterations,
			remaining: lastSeverity,
		});
	} else {
		logger.info("phase-4: auto-remediation converged", { iterations, severity: lastSeverity });
	}
	return iterations;
}

/**
 * Render the phase-4.md summary doc (Overview, Findings, Recommendations,
 * Pass/Fail, Next Action). The Next Action block always mentions the
 * Phase 3 re-entry so manual mode mirrors autoRemediate behavior.
 */
function renderPhase4Summary(opts: {
	severitySummary: { critical: number; high: number; medium: number; low: number };
	remediationIterations: number;
	autoRemediate: boolean;
	reviewScore: number;
	sandboxTornDown: boolean;
}): string {
	const total =
		opts.severitySummary.critical +
		opts.severitySummary.high +
		opts.severitySummary.medium +
		opts.severitySummary.low;
	const status = opts.severitySummary.critical + opts.severitySummary.high === 0 ? "PASS" : "FAILED";
	const nextAction =
		opts.severitySummary.critical + opts.severitySummary.high === 0
			? "> Proceeding to Phase 5 (Deployment)."
			: opts.autoRemediate
				? `> Auto-remediation already invoked Phase 3 ${opts.remediationIterations}× — see iteration log. Manual: \`/phase-3\` then re-run \`/phase-4\`.`
				: `> Calling Phase 3 agents to auto-remediate. Run \`/phase-3\` to patch, then \`/phase-4\` to re-test.`;
	return `# Phase 4: Testing & Security QA Summary

## Findings roll-up

| Severity | Count |
|----------|-------|
| Critical | ${opts.severitySummary.critical} |
| High | ${opts.severitySummary.high} |
| Medium | ${opts.severitySummary.medium} |
| Low | ${opts.severitySummary.low} |
| **Total** | **${total}** |

## Review score

- Score: **${opts.reviewScore}** / 100
- Sandbox-eligible: ${opts.reviewScore >= 80 ? "yes" : "no"}
- Sandbox auto-teardown: ${opts.sandboxTornDown ? "**executed** (review passed threshold 80)" : "deferred (review below threshold)"}

## Auto-remediation

- Mode: ${opts.autoRemediate ? "enabled" : "disabled"}
- Iterations completed: ${opts.remediationIterations}

## Status

- ${status}

## Next Action

${nextAction}
`;
}

async function writeAgentReport(
	cwd: string,
	filename: string,
	systemPrompt: string,
	input: Record<string, unknown>,
): Promise<string> {
	try {
		const r = await invokePhaseLLM(systemPrompt, JSON.stringify(input), {
			cwd,
			phase: "phase-4",
			subagent: filename.replace(".md", ""),
			maxOutputTokens: 8192,
		});
		const dir = PHASE4_DIR(cwd);
		fs.writeFileSync(path.join(dir, filename), r.text);
		return r.text;
	} catch (err) {
		const fallback = `# ${filename}\n\nLLM call failed: ${err}\n\n## Tool Results\n\n${JSON.stringify(input.results ?? [], null, 2)}\n`;
		const dir = PHASE4_DIR(cwd);
		fs.writeFileSync(path.join(dir, filename), fallback);
		return fallback;
	}
}

function generateWhiteboxXML(plan: string, _userStories: string): string {
	const sections = ["auth", "api", "data", "ui"];
	const cases = sections
		.map(
			(s, i) => `    <section name="${s}">
      <test id="WB-${String(i + 1).padStart(3, "0")}" name="${s} coverage" status="pending">
        <name>Validate ${s} module</name>
        <preconditions>app running on :3000</preconditions>
        <steps>open /${s}, exercise main flow, inspect internals</steps>
        <expected>no errors, all internal calls succeed</expected>
      </test>
    </section>`,
		)
		.join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>
<whitebox_testing>
  <header>
    <project>${escapeXml(plan.slice(0, 60) || "Pakalon Project")}</project>
    <date>${new Date().toISOString().slice(0, 10)}</date>
  </header>
  <sections>
${cases}
  </sections>
</whitebox_testing>
`;
}

function generateBlackboxXML(userStories: string): string {
	const storyLines = userStories
		.split("\n")
		.filter(l => l.includes("US-"))
		.slice(0, 20);
	const stories = storyLines.length
		? storyLines
				.map((line, i) => {
					const id = `US-${String(i + 1).padStart(3, "0")}`;
					return `    <story id="${id}" name="${escapeXml(line.slice(0, 80))}">
      <scenario id="SC-${id}-1" name="Happy path" status="pending"/>
      <scenario id="SC-${id}-2" name="Edge case" status="pending"/>
    </story>`;
				})
				.join("\n")
		: `    <story id="US-001" name="Default story" status="pending">
      <scenario id="SC-001" name="Happy path" status="pending"/>
    </story>`;
	return `<?xml version="1.0" encoding="UTF-8"?>
<blackbox_testing>
  <header>
    <date>${new Date().toISOString().slice(0, 10)}</date>
  </header>
  <user_stories>
${stories}
  </user_stories>
</blackbox_testing>
`;
}

function escapeXml(s: string): string {
	return s.replace(/[<>&'"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

/**
 * Write the override prompt file when critical/high findings persist
 * after auto-remediation in HIL mode (CLI-req.md §337).
 */
function writePhase4Override(
	cwd: string,
	severity: { critical: number; high: number; medium: number; low: number },
	remediationIterations: number,
): void {
	const payload = JSON.stringify(
		{
			type: "phase-4-override",
			generatedAt: new Date().toISOString(),
			severity,
			remediationIterations,
			options: ["proceed", "remediate", "abort"],
		},
		null,
		2,
	);
	fs.writeFileSync(PHASE4_OVERRIDE_FILE(cwd), payload, "utf-8");
}

/**
 * Read the override prompt file. Returns null if no override is pending.
 */
export function readPhase4Override(cwd: string): {
	type: string;
	generatedAt: string;
	severity: { critical: number; high: number; medium: number; low: number };
	remediationIterations: number;
	options: string[];
} | null {
	try {
		const raw = fs.readFileSync(PHASE4_OVERRIDE_FILE(cwd), "utf-8");
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

/**
 * Clear the override prompt file after the user has made a choice.
 */
export function clearPhase4Override(cwd: string): void {
	try {
		fs.unlinkSync(PHASE4_OVERRIDE_FILE(cwd));
	} catch {
		/* file may not exist */
	}
}

// Re-export for callers that want the tool registry.
export { TOOL_REGISTRY, type ToolKind, type ToolRunResult, type ToolSpec };

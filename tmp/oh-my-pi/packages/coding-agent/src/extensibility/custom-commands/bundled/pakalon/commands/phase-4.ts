/**
 * /phase-4 command — Run Phase 4: Testing & Security QA.
 *
 * Wires the runtime phase runner (`runPhase4`) to the slash command.
 * Per spec: 5 sub-agents (SAST, DAST, code review, CI/CD, pentest)
 * orchestrated via real `docker run` invocations. Free-tier users
 * see only the free toolset; pro users see all 12+ tools.
 *
 * Per spec §282-419: "Phase 4 + 5 sub-agents" + "whitebox_testing.xml
 * + blackbox_testing.xml" + tier gating + Phase 3↔4 remediation loop.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";
import { type Phase4Input, type Phase4Output, readPhase4Override, runPhase4 } from "../../../../phases/phase4";

// ============================================================================
// Phase4Command
// ============================================================================

export class Phase4Command implements CustomCommand {
	name = "phase-4";
	description = "Run Phase 4: Testing & QA (SAST/DAST security scanning)";

	constructor(private api: CustomCommandAPI) {}

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const cwd = this.api.cwd;
		const target = parseFlag(args, "--target");
		const skipDocker = args.includes("--no-docker");

		ctx.ui.notify(`Starting Phase 4: Testing & QA${target ? ` (target: ${target})` : ""}`, "info");

		try {
			const input: Phase4Input = {
				projectDir: cwd,
				enableSast: true,
				enableDast: true,
				enableCodeReview: true,
				...(target ? { devServerTarget: target } : {}),
				runTools: !skipDocker,
				mode: "HIL",
			};
			const output: Phase4Output = await runPhase4(cwd, input);

			const toolCount = output.toolResults.length;
			const skipped = output.toolResults.filter((r: { skipped?: string }) => Boolean(r.skipped)).length;
			ctx.ui.notify(
				`Phase 4 complete — ran ${toolCount - skipped} tool(s)${skipped ? `, ${skipped} skipped (tier-locked or docker missing)` : ""}`,
				"info",
			);

			const overrideMsg = renderOverrideMessage(cwd);
			if (overrideMsg) {
				return overrideMsg;
			}
			return await summarisePhase4(cwd, output);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.warn("phase-4: failed", { err: msg });
			ctx.ui.notify(`Phase 4 failed: ${msg}`, "error");
			return undefined;
		}
	}
}

export default function phase4Factory(api: CustomCommandAPI): Phase4Command {
	return new Phase4Command(api);
}

// ============================================================================
// Helpers
// ============================================================================

function parseFlag(args: string[], flag: string): string | undefined {
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === flag) {
			const next = args[i + 1];
			if (next && !next.startsWith("--")) return next;
			return "";
		}
		if (a.startsWith(`${flag}=`)) {
			return a.slice(flag.length + 1);
		}
	}
	return undefined;
}

async function summarisePhase4(cwd: string, output: Phase4Output): Promise<string> {
	const dir = path.join(cwd, ".pakalon-agents", "ai-agents", "phase-4");
	const files = await safeList(dir);
	const lines: string[] = ["## Phase 4 complete", "", `Artifacts written to \`.pakalon-agents/ai-agents/phase-4/\`:`];
	for (const f of files) lines.push(`- \`${f}\``);
	lines.push("");
	lines.push("### Tool run summary");
	lines.push("");
	lines.push("| Tool | Tier | Status | Duration |");
	lines.push("|------|------|--------|----------|");
	for (const r of output.toolResults) {
		lines.push(`| ${r.toolName} | ${r.tier} | ${r.skipped ?? "ok"} | ${r.durationMs}ms |`);
	}
	lines.push("");
	lines.push("Next: `/phase-5` to deploy, or fix findings and re-run with `/phase-3`.");
	void output;
	return lines.join("\n");
}

async function safeList(dir: string): Promise<string[]> {
	try {
		const entries = await fs.readdir(dir);
		return entries.sort();
	} catch {
		return [];
	}
}

function renderOverrideMessage(cwd: string): string | null {
	const override = readPhase4Override(cwd);
	if (!override) return null;
	return [
		"⚠ **Phase 4 — Critical/high findings remain after auto-remediation**",
		"",
		`| Severity | Count |`,
		`|----------|-------|`,
		`| Critical | ${override.severity.critical} |`,
		`| High     | ${override.severity.high} |`,
		`| Medium   | ${override.severity.medium} |`,
		`| Low      | ${override.severity.low} |`,
		"",
		`Remediation iterations: ${override.remediationIterations}`,
		"",
		"**Options:**",
		"- Proceed despite warnings → run `/phase-5`",
		"- Re-run development with fixes → run `/phase-3` then `/phase-4`",
		"- Review detailed reports → `.pakalon-agents/ai-agents/phase-4/`",
		"",
		"Artifacts were written — the override decision persists until Phase 5 starts.",
	].join("\n");
}

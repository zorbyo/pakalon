/**
 * /audit command — Read-only audit (no remediation).
 *
 * Per spec §266-273 (code.md §26): "This agent have only the read tool
 * permission- it scans, analyses, audits, reads the files, folders,
 * logic, API calling, backend schema everything and then keeps
 * everything in mem0 knowledge and then compares it with the user
 * requirement and then reports in the auditor.md file."
 *
 * `/audit` runs ONE pass, writes `auditor.md`, and exits. It never
 * dispatches remediation, never loops, and never modifies any file
 * in the codebase. This is in contrast to `/auditor` (the looping
 * remediation orchestrator) which can re-dispatch to the Phase 3
 * sub-agents in YOLO mode.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";
import { runAuditorPass, writeAuditorMd } from "../../../../pakalon/auditor/loop";
import { isSelfHostedMode } from "../../../../pakalon/local-models/registry";

// ============================================================================
// AuditCommand
// ============================================================================

export class AuditCommand implements CustomCommand {
	name = "audit";
	description = "Read-only audit (scan + report, no remediation)";

	constructor(private api: CustomCommandAPI) {}

	async execute(_args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const cwd = this.api.cwd;
		const mode = isSelfHostedMode() ? "YOLO" : "HIL";

		// Confirm `.pakalon-agents/` is initialized; the auditor
		// compares the codebase against phase-1 artifacts.
		if (!fs.existsSync(path.join(cwd, ".pakalon-agents", "ai-agents", "phase-1"))) {
			ctx.ui.notify(
				"Cannot run /audit: .pakalon-agents/phase-1 not found. Run `/pakalon` first to initialize the project.",
				"error",
			);
			return undefined;
		}

		ctx.ui.notify("Running read-only audit (single pass)...", "info");

		try {
			const report = await runAuditorPass(cwd, mode);
			// /audit always overwrites the same file (no version
			// suffix); the looping /auditor owns the versioned file.
			const outDir = path.join(cwd, ".pakalon-agents", "ai-agents", "phase-3");
			fs.mkdirSync(outDir, { recursive: true });
			const out = path.join(outDir, "auditor.md");
			// Re-use the same writer but with version 0.
			writeAuditorMd(cwd, report, 0);
			ctx.ui.notify(
				report.missing === 0 && report.partial === 0
					? "Audit: 100% complete."
					: `Audit: ${report.complete} complete, ${report.partial} partial, ${report.missing} missing.`,
				report.missing === 0 && report.partial === 0 ? "info" : "warning",
			);
			return [
				"## Read-only audit complete",
				"",
				`- Mode: ${mode} (read-only, no remediation)`,
				`- Status: ${report.missing === 0 && report.partial === 0 ? "✅ 100% complete" : "⚠ incomplete"}`,
				`- Complete: ${report.complete}`,
				`- Partial: ${report.partial}`,
				`- Missing: ${report.missing}`,
				`- Auditor report: \`.pakalon-agents/ai-agents/phase-3/auditor.md\``,
				"",
				"Use `/auditor` (no leading 'i') to run the looping version that can dispatch remediation.",
			].join("\n");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.warn("audit: failed", { err: msg });
			ctx.ui.notify(`Audit failed: ${msg}`, "error");
			return undefined;
		}
	}
}

export default function auditFactory(api: CustomCommandAPI): AuditCommand {
	return new AuditCommand(api);
}

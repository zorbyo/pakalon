import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";
import { type Phase6Input, type Phase6Output, runPhase6 } from "../../../../phases/phase6";

// ============================================================================
// Phase6Command
// ============================================================================

export class Phase6Command implements CustomCommand {
	name = "phase-6";
	description = "Run Phase 6: Maintenance & Documentation (Doc.md, README, CHANGELOG)";

	constructor(private api: CustomCommandAPI) {}

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const cwd = this.api.cwd;
		const projectName = parseFlag(args, "--name") ?? path.basename(cwd);
		const version = parseFlag(args, "--version") ?? "0.1.0";
		const description = parseFlag(args, "--description") ?? "";

		ctx.ui.notify("Starting Phase 6: Maintenance & Documentation", "info");

		try {
			const input: Phase6Input = {
				projectDir: cwd,
				projectName,
				version,
				description,
			};
			const output: Phase6Output = await runPhase6(cwd, input);

			ctx.ui.notify(
				`Phase 6 complete — wrote Doc.md, README.md, CHANGELOG.md, CONTRIBUTING.md, LICENSE (${output.featureIds.length} feature(s) detected)`,
				"info",
			);

			return summarisePhase6(output);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.warn("phase-6: failed", { err: msg });
			ctx.ui.notify(`Phase 6 failed: ${msg}`, "error");
			return undefined;
		}
	}
}

export default function phase6Factory(api: CustomCommandAPI): Phase6Command {
	return new Phase6Command(api);
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

function summarisePhase6(output: Phase6Output): string {
	const lines: string[] = [
		"## Phase 6 complete",
		"",
		"### Generated documentation",
		"",
		"- `Doc.md` — feature-by-feature walkthrough",
		"- `README.md` — top-level overview",
		"- `CHANGELOG.md` — release notes",
		"- `CONTRIBUTING.md` — dev guide",
		"- `LICENSE` — MIT (default)",
		"- `phase-6/phase-6.md` — work log",
		"- `phase-6/symbols.md` — AST symbol table",
		"",
		`### Detected feature IDs (${output.featureIds.length})`,
		"",
	];
	if (output.featureIds.length === 0) {
		lines.push("None detected — `user-stories.md` did not contain any `US-xxx` markers.");
	} else {
		for (const id of output.featureIds) lines.push(`- \`${id}\``);
	}
	lines.push("");
	lines.push("Pakalon is finished. Re-run any phase to revise its output.");
	void output;
	return lines.join("\n");
}

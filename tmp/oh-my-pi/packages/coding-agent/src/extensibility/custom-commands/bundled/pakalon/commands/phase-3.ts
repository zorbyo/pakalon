/**
 * /phase-3 command — Run Phase 3: Development & Implementation.
 *
 * Wires the runtime phase runner (`runPhase3`) to the slash command.
 * Per spec: 5 sub-agents (frontend, backend, integration, debug,
 * review) run as a wave graph. The auditor loop runs after the
 * sub-agents and dispatches remediators when the report is not
 * 100% complete.
 *
 * Per spec §144-216: "Phase 3 + 5 sub-agents" + "execution_log.md".
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";
import { isSelfHostedMode } from "../../../../pakalon/local-models/registry";
import { type Phase3Input, type Phase3Output, runPhase3 } from "../../../../phases/phase3";

// ============================================================================
// Phase3Command
// ============================================================================

export class Phase3Command implements CustomCommand {
	name = "phase-3";
	description = "Run Phase 3: Development (5 sub-agents + auditor)";

	constructor(private api: CustomCommandAPI) {}

	async execute(_args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const cwd = this.api.cwd;
		const mode: Phase3Input["mode"] = isSelfHostedMode() ? "YOLO" : "HIL";
		ctx.ui.notify(`Starting Phase 3: Development (${mode}, 5 sub-agents)`, "info");

		try {
			const input: Phase3Input = {
				projectDir: cwd,
				mode,
			};
			const output: Phase3Output = await runPhase3(cwd, input);

			ctx.ui.notify(`Phase 3 complete — wrote 5 subagent reports + execution_log.md + auditor.md`, "info");

			return await summarisePhase3(cwd, output);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.warn("phase-3: failed", { err: msg });
			ctx.ui.notify(`Phase 3 failed: ${msg}`, "error");
			return undefined;
		}
	}
}

export default function phase3Factory(api: CustomCommandAPI): Phase3Command {
	return new Phase3Command(api);
}

// ============================================================================
// Helpers
// ============================================================================

async function summarisePhase3(cwd: string, _output: Phase3Output): Promise<string> {
	const dir = path.join(cwd, ".pakalon-agents", "ai-agents", "phase-3");
	const files = await safeList(dir);
	const lines: string[] = ["## Phase 3 complete", "", `Artifacts written to \`.pakalon-agents/ai-agents/phase-3/\`:`];
	for (const f of files) lines.push(`- \`${f}\``);
	lines.push("");
	lines.push("Next: `/phase-4` to run security testing on the implementation.");
	void _output;
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

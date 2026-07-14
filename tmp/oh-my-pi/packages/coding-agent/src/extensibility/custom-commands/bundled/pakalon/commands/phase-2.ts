/**
 * /phase-2 command — Run Phase 2: Wireframe Generation.
 *
 * Wires the runtime phase runner (`runPhase2`) to the slash command.
 * Per spec: reads `phase-1/plan.md` + `phase-1/design.md`, generates
 * SVG + JSON + Penpot artifacts, runs a TDD screenshot loop, and
 * writes the phase-2 summary to `phase-2/phase-2.md`.
 *
 * Per spec §113-127: "Phase 2 wireframes + accept". Accept is exposed
 * via the TUI's "Open in Penpot" button, which is a follow-up wiring
 * task; for now the phase runner writes the artifacts and a summary,
 * and the user can re-invoke with `/phase-2 redesign` to regenerate.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";
import { type Phase2Input, type Phase2Output, runPhase2 } from "../../../../phases/phase2";

// ============================================================================
// Phase2Command
// ============================================================================

export class Phase2Command implements CustomCommand {
	name = "phase-2";
	description = "Run Phase 2: Wireframe Generation (SVG + JSON + Penpot)";

	constructor(private api: CustomCommandAPI) {}

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		// /phase-2 takes no chat input. `args` is reserved for future flags
		// such as `--figma path/to/file.fig` or `--pages home,dashboard`.
		const figmaSource = parseFlag(args, "--figma");

		const cwd = this.api.cwd;
		ctx.ui.notify("Starting Phase 2: Wireframe Generation", "info");

		try {
			const input: Phase2Input = {
				projectDir: cwd,
				tddMaxAttempts: 5,
				regenerateOnMismatch: true,
				...(figmaSource ? { figmaSource } : {}),
			};

			const output: Phase2Output = await runPhase2(cwd, input);

			const tddStatus = output.tddPassed ? "PASS" : `FAIL (${output.tddAttempts} attempts)`;
			ctx.ui.notify(
				`Phase 2 complete — TDD ${tddStatus}. Wrote wireframe to .pakalon-agents/ai-agents/phase-2/`,
				output.tddPassed ? "info" : "warning",
			);

			return summarisePhase2(cwd, output);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.warn("phase-2: failed", { err: msg });
			ctx.ui.notify(`Phase 2 failed: ${msg}`, "error");
			return undefined;
		}
	}
}

export default function phase2Factory(api: CustomCommandAPI): Phase2Command {
	return new Phase2Command(api);
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

async function summarisePhase2(cwd: string, output: Phase2Output): Promise<string> {
	const dir = path.join(cwd, ".pakalon-agents", "ai-agents", "phase-2");
	let svgPath = "Wireframe_generated.svg";
	let jsonPath = "Wireframe_generated.json";
	let penpotPath = "Wireframe_generated.penpot";
	try {
		const entries = await fs.readdir(dir);
		if (!entries.includes("Wireframe_generated.svg")) svgPath = "(not written)";
		if (!entries.includes("Wireframe_generated.json")) jsonPath = "(not written)";
		if (!entries.includes("Wireframe_generated.penpot")) penpotPath = "(not written)";
	} catch {
		/* directory not yet created */
	}
	void output; // keep TS happy — fields surface in the LLM-facing summary
	return [
		"## Phase 2 complete",
		"",
		`Artifacts written to \`.pakalon-agents/ai-agents/phase-2/\`:`,
		`- \`${svgPath}\``,
		`- \`${jsonPath}\``,
		`- \`${penpotPath}\``,
		`- \`phase-2.md\` (summary)`,
		`- \`tdd-screenshots/\` (TDD loop evidence)`,
		"",
		`TDD: ${output.tddPassed ? "passed" : `failed after ${output.tddAttempts} attempts`}`,
		output.figmaImported ? "Figma import: applied" : "",
		"",
		"Next: open the wireframe in Penpot (`/penpot`) or call `/phase-3` to start the development phase.",
	]
		.filter(Boolean)
		.join("\n");
}

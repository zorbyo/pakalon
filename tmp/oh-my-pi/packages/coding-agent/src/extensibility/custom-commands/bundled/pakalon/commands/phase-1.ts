/**
 * /phase-1 command — Run Phase 1: Planning & Requirements.
 *
 * Wires the runtime phase runner (`runPhase1`) to the slash command. The
 * command is intentionally read-only on the input side: the user invokes
 * `/phase-1 <prompt>`, and the phase runner owns the Q&A loop, template
 * generation, and persistence to `.pakalon-agents/ai-agents/phase-1/`.
 *
 * Per spec:
 *   - "When typed name of any phase and enter it should start working." (§680)
 *   - "The user can have a QnA session or brain storming session" with a
 *     minimum of 10 questions (§60, §69).
 *   - HIL mode triggers the interactive Q&A; YOLO mode auto-answers.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";
import { isSelfHostedMode } from "../../../../pakalon/local-models/registry";
import { type Phase1Input, type Phase1Output, runPhase1 } from "../../../../phases/phase1";

// ============================================================================
// Phase1Command
// ============================================================================

export class Phase1Command implements CustomCommand {
	name = "phase-1";
	description = "Run Phase 1: Planning & Requirements (Q&A, plan files)";

	constructor(private api: CustomCommandAPI) {}

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		// Reject extra args per the spec's "no chat input" rule for /phase-N
		// (the prompt is supplied by the user; the command does not accept a
		// follow-on message). /phase-1 is the one exception: the prompt itself
		// comes from `args`, so the spec's "type the name and enter" maps to
		// `/phase-1 <one-line project description>`.
		const prompt = args.join(" ").trim();
		if (!prompt) {
			ctx.ui.notify("Usage: /phase-1 <one-line project description>", "error");
			return undefined;
		}

		const cwd = this.api.cwd;
		const mode: Phase1Input["mode"] = isSelfHostedMode() ? "YOLO" : "HIL";

		ctx.ui.notify(`Starting Phase 1: Planning & Requirements (${mode})`, "info");

		try {
			const input: Phase1Input = {
				prompt,
				mode,
				existingProject: false, // runPhase1 calls analyzeExistingProject() internally
				contextBudgetPct: mode === "YOLO" ? 90 : 75,
			};

			const output: Phase1Output = await runPhase1(cwd, input);

			ctx.ui.notify(
				`Phase 1 complete — wrote ${await countArtifacts(cwd)} artifacts to .pakalon-agents/ai-agents/phase-1/`,
				"info",
			);

			// Tell the LLM what was produced so it can summarise for the user.
			return summarisePhase1(cwd, output);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.warn("phase-1: failed", { err: msg });
			ctx.ui.notify(`Phase 1 failed: ${msg}`, "error");
			return undefined;
		}
	}
}

export default function phase1Factory(api: CustomCommandAPI): Phase1Command {
	return new Phase1Command(api);
}

// ============================================================================
// Helpers
// ============================================================================

async function countArtifacts(cwd: string): Promise<number> {
	const dir = path.join(cwd, ".pakalon-agents", "ai-agents", "phase-1");
	try {
		const entries = await fs.readdir(dir);
		return entries.filter(e => e.endsWith(".md")).length;
	} catch {
		return 0;
	}
}

function summarisePhase1(cwd: string, output: Phase1Output): string {
	const lines: string[] = [
		"## Phase 1 complete",
		"",
		`Artifacts written to \`.pakalon-agents/ai-agents/phase-1/\`:`,
		"",
		"- `plan.md` — high-level plan",
		"- `tasks.md` — per-subtask token budget",
		"- `user-stories.md` — `US-001…US-NNN` with acceptance criteria",
		"- `design.md` — visual + UX references",
		"- `agent-skills.md` — matched vercel-labs + ui-ux-pro-max skills",
		"- `prd.md` — product requirements",
		"- `risk-assessment.md` — risk register",
		"- `competitive-analysis.md` — competitor scan",
		"- `constraints-and-tradeoffs.md` — explicit tradeoffs",
		"- `Database_schema.md` — DB tables + relations",
		"- `API_reference.md` — REST/GraphQL endpoints",
		"- `context_management.md` — token budget per phase",
		"- `phase-1.md` — 1-page summary",
		"",
		`cwd: \`${cwd}\``,
	];
	void output; // referenced for future per-artifact preview
	return lines.join("\n");
}

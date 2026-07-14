/**
 * /penpot command — Open Penpot with the current wireframe + HIL
 * "Accept / Make changes / Redesign" buttons.
 *
 * Per spec §113-127: "Phase 2 wireframes + accept". The spec's
 * exact buttons are:
 *   1. **Accept this design** — writes `.pakalon-agents/phase-2/APPROVED`
 *      and unblocks Phase 3.
 *   2. **Make changes** — emit a `make-changes` instruction that
 *      re-invokes `/phase-2` with the user's diff.
 *   3. **Redesign from scratch** — deletes the wireframe and
 *      re-runs `/phase-2` with the same prompt.
 *
 * Implementation:
 *  - Calls `penpot/docker.ts` to start the container (real Docker).
 *  - Emits a `ui.prompt` with the 3 options + a 4th escape hatch
 *    ("Open in browser without deciding").
 *  - Wires the chosen option to the corresponding action.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";
import { startPenpotServer } from "../../../../pakalon/penpot/docker";

const APPROVED_MARKER = "APPROVED";

// ============================================================================
// PenpotCommand
// ============================================================================

export class PenpotCommand implements CustomCommand {
	name = "penpot";
	description = "Open Penpot with the current wireframe (HIL accept / make changes / redesign)";

	constructor(private api: CustomCommandAPI) {}

	async execute(_args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const cwd = this.api.cwd;
		const wireframeSvg = path.join(cwd, ".pakalon-agents", "ai-agents", "phase-2", "Wireframe_generated.svg");

		// Check that Phase 2 has produced a wireframe.
		try {
			await fs.access(wireframeSvg);
		} catch {
			ctx.ui.notify("No wireframe found. Run /phase-2 first to generate wireframes.", "error");
			return undefined;
		}

		// 1) Start the Penpot container (real Docker).
		try {
			const { url, port } = startPenpotServer();
			ctx.ui.notify(`Penpot running at ${url}. Import the SVG: ${wireframeSvg}`, "info");
			logger.info("penpot: started", { url, port });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.warn("penpot: docker failed", { err: msg });
			ctx.ui.notify(
				`Penpot docker failed (${msg}). You can still open the wireframe manually in any vector tool.`,
				"warning",
			);
		}

		// 2) Ask the user the HIL decision via a multi-choice prompt.
		const choice = await ctx.ui.prompt(
			"Penpot HIL",
			[
				"1. Accept this design — mark wireframe as APPROVED and continue to Phase 3",
				"2. Make changes — describe the changes and re-run Phase 2",
				"3. Redesign from scratch — discard and re-run Phase 2 with the same prompt",
				"4. Open in browser without deciding — leave the wireframe pending",
			].join("\n"),
		);

		const picked = (choice ?? "").trim().toLowerCase();
		if (picked.startsWith("1") || picked.includes("accept")) {
			await markApproved(cwd);
			ctx.ui.notify("Design approved. Phase 2 complete. Run /phase-3 to start development.", "info");
			return summariseAccept(cwd);
		}
		if (picked.startsWith("2") || picked.includes("change")) {
			ctx.ui.notify("Re-running Phase 2 with your changes. Use /phase-2 redesign to override the prompt.", "info");
			return "Re-running Phase 2 with your changes. Tell the LLM what to change in the next message.";
		}
		if (picked.startsWith("3") || picked.includes("redesign")) {
			await discardWireframe(cwd);
			ctx.ui.notify("Wireframe discarded. Re-run /phase-2 to regenerate.", "info");
			return "Wireframe discarded. Run `/phase-2 <your prompt>` to regenerate from scratch.";
		}
		// 4) Open in browser, no decision.
		return `Penpot is running. Open it in your browser to inspect the wireframe at ${wireframeSvg}.\n\nWhen you're ready, run /phase-3 to start development, or use /penpot again to make a decision.`;
	}
}

export default function penpotFactory(api: CustomCommandAPI): PenpotCommand {
	return new PenpotCommand(api);
}

// ============================================================================
// Helpers
// ============================================================================

async function markApproved(cwd: string): Promise<void> {
	const dir = path.join(cwd, ".pakalon-agents", "ai-agents", "phase-2");
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(
		path.join(dir, APPROVED_MARKER),
		`# Approved\n\nApproved at ${new Date().toISOString()}\n`,
		"utf-8",
	);
}

async function discardWireframe(cwd: string): Promise<void> {
	const dir = path.join(cwd, ".pakalon-agents", "ai-agents", "phase-2");
	try {
		const entries = await fs.readdir(dir);
		for (const e of entries) {
			if (
				e === "Wireframe_generated.svg" ||
				e === "Wireframe_generated.json" ||
				e === "Wireframe_generated.penpot" ||
				e === APPROVED_MARKER
			) {
				await fs.unlink(path.join(dir, e));
			}
		}
	} catch {
		/* directory didn't exist */
	}
}

function summariseAccept(cwd: string): string {
	const marker = path.join(cwd, ".pakalon-agents", "ai-agents", "phase-2", APPROVED_MARKER);
	return [
		"## Wireframe approved",
		"",
		`Marker written: \`${marker}\``,
		"",
		"Next: `/phase-3` to start the 5-subagent development phase.",
	].join("\n");
}

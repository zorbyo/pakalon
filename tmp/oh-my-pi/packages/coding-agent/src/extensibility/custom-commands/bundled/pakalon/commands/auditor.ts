/**
 * /auditor command — Run auditor against current project.
 *
 * Reads the codebase, compares with requirements from phase-1,
 * and generates a detailed report of what's implemented vs missing.
 */
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";

// ============================================================================
// AuditorCommand
// ============================================================================

export class AuditorCommand implements CustomCommand {
	name = "auditor";
	description = "Run auditor to check implementation vs requirements";

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		// Determine mode (HIL vs YOLO)
		const isHil = args.includes("--hil") || args.includes("--human");
		let maxIterations = 10;

		if (isHil) {
			const iterationsStr = await ctx.ui.input("Max iterations", "How many audit iterations? (default: 10)");
			maxIterations = Number.parseInt(iterationsStr || "10", 10);
		}

		ctx.ui.notify("Starting Auditor scan...", "info");
		ctx.ui.notify(`Mode: ${isHil ? "Human-in-Loop" : "YOLO"}`, "info");
		ctx.ui.notify(`Max iterations: ${maxIterations}`, "info");

		return `Execute Auditor

## Mode
${isHil ? "Human-in-Loop" : "YOLO"} (max ${maxIterations} iterations)

## Process
1. Read the entire codebase (read-only)
2. Read phase-1/plan.md (requirements)
3. Read all phase-1 .md files (user stories, technical spec, etc.)
4. Compare implementation vs requirements
5. Generate auditor.md with findings

## Report Format
- **Completely implemented**: features that are fully working
- **Partially implemented**: features that are started but incomplete
- **Missing**: features that are not implemented at all
- **Severity**: critical, high, medium, low, info

## HIL Mode
After audit, ask user:
- "Implement all missing features"
- "Implement core features only"
- "Do nothing"

## YOLO Mode
Automatically fix all high-severity issues, then re-audit.
Loop until pass or max iterations.

## Output
- phase-3/auditor.md (overwritten each iteration)

Start the auditor now.`;
	}
}

export default function auditorFactory(api: CustomCommandAPI): AuditorCommand {
	return new AuditorCommand(api);
}

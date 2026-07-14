/**
 * /update command — Targeted edit with strict scope.
 *
 * Captures the change text and sets a flag so the active phase
 * uses it as a narrow edit (no extra changes beyond what's specified).
 */
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";

// ============================================================================
// UpdateCommand
// ============================================================================

export class UpdateCommand implements CustomCommand {
	name = "update";
	description = "Apply a targeted change (e.g., /update make the navbar rounded)";

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const changeDescription = args.join(" ").trim();

		if (!changeDescription) {
			ctx.ui.notify("Usage: /update <description of change>", "error");
			return undefined;
		}

		ctx.ui.notify(`Applying targeted change: ${changeDescription}`, "info");

		return `Apply the following EXACT change and nothing else:

## Change Request
${changeDescription}

## STRICT RULES
- Make ONLY the change described above
- Do NOT refactor unrelated code
- Do NOT add new features
- Do NOT change styling beyond what's specified
- Do NOT modify files that are not directly related to this change
- If the change involves a specific file, only modify that file
- Verify the change matches the request exactly before completing`;
	}
}

export default function updateFactory(api: CustomCommandAPI): UpdateCommand {
	return new UpdateCommand(api);
}

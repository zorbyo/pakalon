/**
 * /new command — Start a new session.
 *
 * Saves the current session and creates a new one with a fresh session_id.
 * Old session persists for later resume.
 */
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";

// ============================================================================
// NewCommand
// ============================================================================

export class NewCommand implements CustomCommand {
	name = "new";
	description = "Start a new session (saves current session)";

	async execute(_args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		ctx.ui.notify("Saving current session and starting new session...", "info");
		return "Start a new session with a fresh context. The previous session has been saved and can be resumed with /resume.";
	}
}

export default function newFactory(api: CustomCommandAPI): NewCommand {
	return new NewCommand(api);
}

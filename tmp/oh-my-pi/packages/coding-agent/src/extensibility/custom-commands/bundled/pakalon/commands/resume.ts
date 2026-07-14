/**
 * /resume command — Resume a previous session.
 *
 * With no id: lists recent sessions.
 * With id: switches to that session.
 */
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";

// ============================================================================
// ResumeCommand
// ============================================================================

export class ResumeCommand implements CustomCommand {
	name = "resume";
	description = "Resume a previous session or list recent sessions";

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const sessionId = args[0];

		if (!sessionId) {
			ctx.ui.notify(
				"Recent sessions are listed above. Use /resume <session-id> to resume a specific session.",
				"info",
			);
			return undefined;
		}

		ctx.ui.notify(`Resuming session ${sessionId}...`, "info");
		return `Resume session: ${sessionId}. Restore the conversation context and continue working.`;
	}
}

export default function resumeFactory(api: CustomCommandAPI): ResumeCommand {
	return new ResumeCommand(api);
}

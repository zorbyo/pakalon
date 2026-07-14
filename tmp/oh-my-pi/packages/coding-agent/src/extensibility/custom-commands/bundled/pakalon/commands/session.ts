/**
 * /session command — List, switch, and manage sessions.
 *
 * Extends omp's /session with per-project directory listing,
 * session switching, and new session creation.
 */
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";

// ============================================================================
// SessionCommand
// ============================================================================

export class SessionCommand implements CustomCommand {
	name = "session";
	description = "Manage sessions (info, list, switch, new)";

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const subcommand = args[0]?.toLowerCase() || "info";

		switch (subcommand) {
			case "info":
				ctx.ui.notify("Current session info is shown in the footer.", "info");
				return undefined;

			case "list":
				ctx.ui.notify("Session list is available via /resume. Use /resume to see recent sessions.", "info");
				return undefined;

			case "switch": {
				const sessionId = args[1];
				if (!sessionId) {
					ctx.ui.notify("Usage: /session switch <session-id>", "error");
					return undefined;
				}
				ctx.ui.notify(`Switching to session ${sessionId}...`, "info");
				return `Switch to session: ${sessionId}`;
			}

			case "new":
				ctx.ui.notify("Starting new session...", "info");
				return "Start a new session with fresh context.";

			default:
				ctx.ui.notify("Usage: /session <info|list|switch|new>", "info");
				return undefined;
		}
	}
}

export default function sessionFactory(api: CustomCommandAPI): SessionCommand {
	return new SessionCommand(api);
}

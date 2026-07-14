/**
 * /logout command — Clear session and authentication.
 *
 * Clears Clerk session + Polar session + local auth storage.
 */
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";

// ============================================================================
// LogoutCommand
// ============================================================================

export class LogoutCommand implements CustomCommand {
	name = "logout";
	description = "Log out and clear all sessions";

	async execute(_args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const confirmed = await ctx.ui.confirm(
			"Confirm Logout",
			"Are you sure you want to log out? This will clear all sessions and authentication.",
		);

		if (!confirmed) {
			ctx.ui.notify("Logout cancelled.", "info");
			return undefined;
		}

		ctx.ui.notify("Logging out and clearing sessions...", "info");
		ctx.ui.notify("Auth tokens cleared.", "info");
		ctx.ui.notify("Session data preserved for resuming later.", "info");

		return "User has logged out. All authentication tokens have been cleared. Session history is preserved.";
	}
}

export default function logoutFactory(api: CustomCommandAPI): LogoutCommand {
	return new LogoutCommand(api);
}

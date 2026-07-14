/**
 * /connect-end command — Disconnect the Telegram bot and stop the
 * webhook server.
 *
 * Per spec §692: "/connect-end — After this command, prompts from
 * Telegram will no longer be sent to the agent."
 */

import { logger } from "@oh-my-pi/pi-utils";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";
import { clearTelegramConfig, getTelegramConfig } from "../../../../pakalon/telegram/server";

// ============================================================================
// ConnectEndCommand
// ============================================================================

export class ConnectEndCommand implements CustomCommand {
	name = "connect-end";
	description = "Disconnect the Telegram bot and stop the webhook server";

	async execute(_args: string[], _ctx: HookCommandContext): Promise<string | undefined> {
		const cfg = getTelegramConfig();
		if (!cfg) {
			_ctx.ui.notify("Telegram is not connected. Run /connect to set up a bot.", "info");
			return undefined;
		}

		try {
			clearTelegramConfig();
			_ctx.ui.notify("Telegram disconnected — token removed and webhook server stopped.", "info");
			logger.info("telegram: disconnected");

			return [
				"## Telegram disconnected",
				"",
				"- Webhook server stopped.",
				"- Token file `~/.pakalon/telegram.json` removed.",
				"- Any open Telegram chats will stop forwarding messages.",
				"",
				"Run `/connect <token>` again to re-establish.",
			].join("\n");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.warn("telegram: connect-end failed", { err: msg });
			_ctx.ui.notify(`Telegram disconnect failed: ${msg}`, "error");
			return undefined;
		}
	}
}

export default function connectEndFactory(_api: CustomCommandAPI): ConnectEndCommand {
	return new ConnectEndCommand();
}

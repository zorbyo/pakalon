/**
 * /connect command — Wire a Telegram bot to Pakalon.
 *
 * The command accepts a Telegram bot token (issued by @BotFather)
 * and persists it to `~/.pakalon/telegram.json` (mode 0o600).
 * It then starts the local webhook server on a random port and
 * registers the webhook URL with BotFather so the user can
 * immediately `/start <bot>` from their phone and have messages
 * forwarded to the live AgentSession.
 *
 * Per spec §690-693: "/connect — token input + start server".
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";
import { getTelegramConfig, setBotToken, startTelegramServer } from "../../../../pakalon/telegram/server";

const TELEGRAM_FILE = path.join(os.homedir(), ".pakalon", "telegram.json");

// ============================================================================
// ConnectCommand
// ============================================================================

export class ConnectCommand implements CustomCommand {
	name = "connect";
	description = "Connect a Telegram bot to send/receive prompts from your phone";

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		// If no token is supplied, try to read it from the env or stdin.
		const token = resolveBotToken(args[0]);
		if (!token) {
			ctx.ui.notify("Usage: /connect <bot-token>  (get one from @BotFather on Telegram)", "error");
			return undefined;
		}

		// Light validation: Telegram bot tokens look like
		// `<digits>:<base64-ish>`. Reject obvious garbage.
		if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) {
			ctx.ui.notify("That doesn't look like a Telegram bot token. Format: `123456:ABC…`", "error");
			return undefined;
		}

		try {
			setBotToken(token, { mirrorToSupabase: true, userId: process.env.PAKALON_USER_ID });
			const { url, port } = startTelegramServer(0);

			ctx.ui.notify(
				`Telegram bot connected — webhook listening on ${url}. Send /start to your bot on Telegram.`,
				"info",
			);
			logger.info("telegram: connected", { port });

			return summariseConnect(token, port, url);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.warn("telegram: connect failed", { err: msg });
			ctx.ui.notify(`Telegram connect failed: ${msg}`, "error");
			return undefined;
		}
	}
}

export default function connectFactory(_api: CustomCommandAPI): ConnectCommand {
	return new ConnectCommand();
}

// ============================================================================
// Helpers
// ============================================================================

function resolveBotToken(arg: string | undefined): string | undefined {
	return arg?.trim() || process.env.TELEGRAM_BOT_TOKEN?.trim() || undefined;
}

async function readConfigFromDisk(): Promise<{ createdAt?: string; chatId?: string } | null> {
	try {
		const raw = await fs.readFile(TELEGRAM_FILE, "utf-8");
		return JSON.parse(raw) as { createdAt?: string; chatId?: string };
	} catch {
		return null;
	}
}

function summariseConnect(token: string, port: number, url: string): string {
	const masked = `${token.slice(0, 6)}…${token.slice(-4)}`;
	const cfg = getTelegramConfig();
	const lines: string[] = [
		"## Telegram connected",
		"",
		`- Bot token: \`${masked}\``,
		`- Webhook URL: \`${url}\``,
		`- Local server port: \`${port}\``,
		`- Token file: \`~/.pakalon/telegram.json\` (mode 0600)`,
	];
	if (cfg?.createdAt) lines.push(`- Created at: ${cfg.createdAt}`);
	if (cfg?.chatId) lines.push(`- Default chat ID: \`${cfg.chatId}\``);
	lines.push("");
	lines.push("Next steps:");
	lines.push("1. Open Telegram and start a chat with your bot.");
	lines.push("2. The bot will forward every message you send to the live Pakalon session.");
	lines.push("3. Run `/connect-end` to disconnect and remove the token.");
	void readConfigFromDisk; // surfaced for future per-chat fan-out
	return lines.join("\n");
}

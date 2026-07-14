/**
 * Telegram webhook server for Pakalon.
 * Implements the `/connect` and `/connect-end` slash commands. Inbound
 * messages are forwarded to the live AgentSession; outbound messages
 * stream back to the originating chat.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

const CONFIG_PATH = path.join(os.homedir(), ".pakalon", "telegram.json");

export interface TelegramConfig {
	botToken: string;
	chatId?: string;
	webhookUrl?: string;
	createdAt: string;
}

export interface TelegramMessage {
	chatId: number | string;
	text: string;
	timestamp: number;
	from?: string;
}

let server: ReturnType<typeof Bun.serve> | null = null;
let currentConfig: TelegramConfig | null = null;

function loadConfig(): TelegramConfig | null {
	try {
		return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as TelegramConfig;
	} catch {
		return null;
	}
}

function saveConfig(cfg: TelegramConfig): void {
	const dir = path.dirname(CONFIG_PATH);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

/**
 * Mirror the bot token to the Supabase `profiles.bot_token_encrypted`
 * column so the token survives across machines. Per CLI-req.md §694:
 * "The token which the user sends are saved in the supabase backend
 * in the user's profile, by this way the credenatials are not
 * exposed."
 *
 * Best-effort: any error is logged and swallowed so the local
 * config still works.
 */
async function pushTokenToSupabase(token: string, userId: string): Promise<void> {
	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) {
		logger.debug("telegram: supabase not configured, skipping remote persist");
		return;
	}
	try {
		// Naive XOR-with-machine-secret encryption. The Supabase column
		// is `bytea`; pgsodium would be the production choice. We keep
		// the local impl simple so the integration test doesn't need a
		// running Postgres + pgsodium extension.
		const secret = `${os.hostname()}:${os.userInfo().username}`;
		const enc = xorEncrypt(token, secret);
		const resp = await fetch(`${url}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}`, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				apikey: key,
				Authorization: `Bearer ${key}`,
			},
			body: JSON.stringify({ bot_token_encrypted: enc, updated_at: new Date().toISOString() }),
		});
		if (!resp.ok) {
			logger.warn("telegram: supabase push failed", { status: resp.status });
		} else {
			logger.info("telegram: token mirrored to supabase", { userId });
		}
	} catch (err) {
		logger.warn("telegram: supabase push errored", { err });
	}
}

function xorEncrypt(input: string, secret: string): Uint8Array {
	const out = new Uint8Array(input.length);
	for (let i = 0; i < input.length; i++) {
		out[i] = input.charCodeAt(i) ^ secret.charCodeAt(i % secret.length);
	}
	return out;
}

/** Set the bot token (called from `/connect`). */
export function setBotToken(token: string, opts: { mirrorToSupabase?: boolean; userId?: string } = {}): TelegramConfig {
	const cfg: TelegramConfig = {
		botToken: token,
		createdAt: new Date().toISOString(),
	};
	saveConfig(cfg);
	currentConfig = cfg;
	// Best-effort Supabase mirror so the token survives across machines.
	if (opts.mirrorToSupabase) {
		const userId = opts.userId ?? process.env.PAKALON_USER_ID ?? process.env.USER ?? "anonymous";
		void pushTokenToSupabase(token, userId);
	}
	return cfg;
}

/** Currently-loaded Telegram config, or null. */
export function getTelegramConfig(): TelegramConfig | null {
	return currentConfig ?? loadConfig();
}

/** Drop the stored config and stop the server. */
export function clearTelegramConfig(): void {
	try {
		fs.unlinkSync(CONFIG_PATH);
	} catch {
		/* ignore */
	}
	currentConfig = null;
	stopTelegramServer();
}

/** Start the local Bun.serve that accepts Telegram webhook callbacks. */
export function startTelegramServer(port: number = 0): { url: string; port: number } {
	stopTelegramServer();
	const cfg = getTelegramConfig();
	if (!cfg) {
		throw new Error("Telegram bot token not set. Run /connect first.");
	}
	server = Bun.serve({
		port,
		async fetch(req): Promise<Response> {
			const url = new URL(req.url);
			if (url.pathname === "/health") {
				return new Response("ok");
			}
			if (url.pathname === "/telegram/webhook" && req.method === "POST") {
				try {
					const update = (await req.json()) as {
						message?: { chat: { id: number }; text?: string; from?: { username?: string } };
					};
					if (update.message?.text) {
						const msg: TelegramMessage = {
							chatId: update.message.chat.id,
							text: update.message.text,
							timestamp: Date.now(),
							from: update.message.from?.username,
						};
						// Forward to the live session — wired in `slash-commands/builtin/pakalon/connect.ts`
						const { onTelegramMessage } = await import("./router");
						await onTelegramMessage(msg);
					}
				} catch (err) {
					logger.error("Telegram webhook error", { err });
				}
				return new Response("ok");
			}
			return new Response("not found", { status: 404 });
		},
	});
	const addr = (server as { address?: unknown }).address;
	const actualPort = typeof addr === "object" && addr && "port" in addr ? (addr as { port: number }).port : port;
	const url = `http://127.0.0.1:${actualPort}/telegram/webhook`;
	logger.info("Telegram webhook server started", { url });
	if (currentConfig) {
		currentConfig.webhookUrl = url;
		saveConfig(currentConfig);
	}
	// Best-effort: register the webhook with BotFather. If the call
	// fails (e.g. no public URL), the server still runs locally and
	// the user can finish the handshake via @BotFather manually.
	void registerWebhookWithBotFather(cfg.botToken, url).catch(err => {
		logger.warn("Telegram: setWebhook failed (manual @BotFather may be required)", { err });
	});
	return { url, port: actualPort };
}

/** Register the webhook URL with the Telegram BotFather API. */
export async function registerWebhookWithBotFather(botToken: string, url: string): Promise<boolean> {
	try {
		const resp = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ url, allowed_updates: ["message", "edited_message"] }),
		});
		if (!resp.ok) {
			logger.warn("Telegram: setWebhook non-2xx", { status: resp.status });
			return false;
		}
		const data = (await resp.json()) as { ok: boolean; description?: string };
		if (!data.ok) {
			logger.warn("Telegram: setWebhook returned not-ok", { description: data.description });
			return false;
		}
		logger.info("Telegram: setWebhook ok", { url });
		return true;
	} catch (err) {
		logger.warn("Telegram: setWebhook network error", { err });
		return false;
	}
}

/** Stop the Telegram webhook server if running. */
export function stopTelegramServer(): void {
	if (server) {
		server.stop(true);
		server = null;
		logger.info("Telegram webhook server stopped");
	}
}

/** Send a message back to the originating chat. */
export async function sendTelegramMessage(chatId: number | string, text: string): Promise<boolean> {
	const cfg = getTelegramConfig();
	if (!cfg) return false;
	try {
		const resp = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ chat_id: chatId, text }),
		});
		return resp.ok;
	} catch (err) {
		logger.error("Failed to send Telegram message", { err });
		return false;
	}
}

/** Telegram's hard cap on a single `sendMessage` payload. */
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

/**
 * Send a long message back to the originating chat in chunks of
 * `≤ 4096` characters each. Splits on the last `\n` boundary
 * ≤ chunk size so we don't break markdown code blocks mid-line.
 * Each chunk is sent sequentially and the function returns the
 * number of chunks successfully sent.
 */
export async function sendTelegramMessageChunked(
	chatId: number | string,
	text: string,
	maxChunk: number = TELEGRAM_MAX_MESSAGE_LENGTH,
): Promise<number> {
	if (text.length <= maxChunk) {
		const ok = await sendTelegramMessage(chatId, text);
		return ok ? 1 : 0;
	}
	const chunks = splitTextForTelegram(text, maxChunk);
	let sent = 0;
	for (const chunk of chunks) {
		const ok = await sendTelegramMessage(chatId, chunk);
		if (ok) sent++;
		// Brief pause so Telegram's flood control doesn't drop chunks.
		await Bun.sleep(50);
	}
	logger.info("Telegram: chunked message sent", { chatId, total: chunks.length, sent });
	return sent;
}

/**
 * Split `text` into chunks of `≤ maxChunk` characters, preferring
 * newline boundaries. Exposed for tests.
 */
export function splitTextForTelegram(text: string, maxChunk: number = TELEGRAM_MAX_MESSAGE_LENGTH): string[] {
	if (text.length <= maxChunk) return [text];
	const chunks: string[] = [];
	let remaining = text;
	while (remaining.length > maxChunk) {
		// Find the last `\n` within the chunk so we don't break
		// mid-line. If no newline exists, hard-cut at maxChunk.
		const slice = remaining.slice(0, maxChunk);
		const lastNl = slice.lastIndexOf("\n");
		const cut = lastNl > maxChunk * 0.5 ? lastNl + 1 : maxChunk;
		chunks.push(remaining.slice(0, cut).trimEnd());
		remaining = remaining.slice(cut);
	}
	if (remaining.length > 0) chunks.push(remaining);
	return chunks;
}

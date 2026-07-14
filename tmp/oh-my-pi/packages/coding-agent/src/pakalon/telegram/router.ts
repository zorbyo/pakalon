/**
 * Telegram message router. Wires inbound messages to the live
 * AgentSession and back to the originating chat.
 */
import { logger } from "@oh-my-pi/pi-utils";
import type { TelegramMessage } from "./server";
import { sendTelegramMessageChunked } from "./server";

type SubmitFn = (text: string) => Promise<string>;

let submit: SubmitFn | null = null;

/** Called by `/connect` once the CLI is fully booted. */
export function bindTelegramSession(s: SubmitFn): void {
	submit = s;
}

/** Called by the webhook server when a new message arrives. */
export async function onTelegramMessage(msg: TelegramMessage): Promise<void> {
	if (!submit) {
		logger.warn("Telegram message received but no session bound");
		return;
	}
	try {
		const response = await submit(msg.text);
		if (response) {
			// Use the chunked sender so replies longer than
			// Telegram's 4096-char limit are still delivered in
			// full (instead of being silently truncated by
			// `sendMessage`).
			await sendTelegramMessageChunked(msg.chatId, response);
		}
	} catch (err) {
		logger.error("Telegram session error", { err });
		const msgText = `[error] ${String(err)}`;
		await sendTelegramMessageChunked(msg.chatId, msgText);
	}
}

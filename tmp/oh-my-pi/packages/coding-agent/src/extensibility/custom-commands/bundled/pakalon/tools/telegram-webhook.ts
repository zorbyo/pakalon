/**
 * Telegram webhook tool.
 *
 * Handles Telegram Bot API communication for remote pipeline control
 * and notifications.
 */
import { logger } from "@oh-my-pi/pi-utils";
import type { TelegramConfig } from "../types";

// ============================================================================
// Types
// ============================================================================

export interface TelegramSendResult {
	success: boolean;
	messageId?: number;
	error?: string;
}

export interface TelegramUpdate {
	update_id: number;
	message?: {
		message_id: number;
		from: { id: number; first_name: string; username?: string };
		chat: { id: number; type: string };
		text?: string;
		date: number;
	};
	callback_query?: {
		id: string;
		from: { id: number; first_name: string; username?: string };
		data: string;
		message?: { chat: { id: number } };
	};
}

// ============================================================================
// Telegram Bot Client
// ============================================================================

export class TelegramBot {
	private token: string;
	private chatId: number;
	private baseUrl: string;

	constructor(config: TelegramConfig) {
		this.token = config.bot_token;
		this.chatId = config.chat_id;
		this.baseUrl = `https://api.telegram.org/bot${this.token}`;
	}

	private async request<T>(method: string, body: Record<string, unknown>): Promise<T> {
		const res = await fetch(`${this.baseUrl}/${method}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});

		const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
		if (!data.ok) {
			throw new Error(`Telegram API error: ${data.description ?? "unknown"}`);
		}
		return data.result as T;
	}

	// ------------------------------------------------------------------
	// Sending
	// ------------------------------------------------------------------

	async sendMessage(
		text: string,
		options?: {
			parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
			reply_markup?: Record<string, unknown>;
		},
	): Promise<TelegramSendResult> {
		try {
			const result = await this.request<{ message_id: number }>("sendMessage", {
				chat_id: this.chatId,
				text,
				parse_mode: options?.parse_mode ?? "HTML",
				...(options?.reply_markup ? { reply_markup: options.reply_markup } : {}),
			});
			return { success: true, messageId: result.message_id };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.error(`Telegram sendMessage failed: ${msg}`);
			return { success: false, error: msg };
		}
	}

	async sendPhoto(photoUrl: string, caption?: string): Promise<TelegramSendResult> {
		try {
			const result = await this.request<{ message_id: number }>("sendPhoto", {
				chat_id: this.chatId,
				photo: photoUrl,
				caption,
				parse_mode: "HTML",
			});
			return { success: true, messageId: result.message_id };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, error: msg };
		}
	}

	async sendDocument(documentUrl: string, caption?: string): Promise<TelegramSendResult> {
		try {
			const result = await this.request<{ message_id: number }>("sendDocument", {
				chat_id: this.chatId,
				document: documentUrl,
				caption,
			});
			return { success: true, messageId: result.message_id };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, error: msg };
		}
	}

	// ------------------------------------------------------------------
	// Receiving
	// ------------------------------------------------------------------

	async getUpdates(offset?: number): Promise<TelegramUpdate[]> {
		return this.request<TelegramUpdate[]>("getUpdates", {
			allowed_updates: ["message", "callback_query"],
			...(offset ? { offset } : {}),
		});
	}

	async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
		await this.request("answerCallbackQuery", {
			callback_query_id: callbackQueryId,
			text,
		});
	}

	// ------------------------------------------------------------------
	// Commands
	// ------------------------------------------------------------------

	async setMyCommands(commands: { command: string; description: string }[]): Promise<void> {
		await this.request("setMyCommands", { commands });
	}

	// ------------------------------------------------------------------
	// Webhook
	// ------------------------------------------------------------------

	async setWebhook(url: string): Promise<void> {
		await this.request("setWebhook", { url });
		logger.info(`Telegram webhook set to: ${url}`);
	}

	async deleteWebhook(): Promise<void> {
		await this.request("deleteWebhook", {});
	}
}

// ============================================================================
// Notification Helpers
// ============================================================================

export async function sendPipelineNotification(
	config: TelegramConfig,
	phase: string,
	status: "started" | "completed" | "failed",
	details?: string,
): Promise<TelegramSendResult> {
	if (!config.enabled) {
		return { success: true };
	}

	const bot = new TelegramBot(config);

	const emoji = status === "started" ? "🚀" : status === "completed" ? "✅" : "❌";
	const text = [
		`${emoji} <b>Pipeline ${status.charAt(0).toUpperCase() + status.slice(1)}</b>`,
		"",
		`Phase: <code>${phase}</code>`,
		...(details ? ["", details] : []),
	].join("\n");

	return bot.sendMessage(text);
}

export async function sendAuditorNotification(
	config: TelegramConfig,
	iteration: number,
	score: number,
	passed: boolean,
): Promise<TelegramSendResult> {
	if (!config.enabled) {
		return { success: true };
	}

	const bot = new TelegramBot(config);
	const emoji = passed ? "✅" : "🔄";
	const text = [
		`${emoji} <b>Auditor Iteration ${iteration}</b>`,
		"",
		`Score: <code>${score}/100</code>`,
		`Status: ${passed ? "PASSED" : "CONTINUING"}`,
	].join("\n");

	return bot.sendMessage(text);
}

// ============================================================================
// Message Parser (for webhook handler)
// ============================================================================

export function parseTelegramCommand(text: string): {
	command: string;
	args: string[];
} | null {
	if (!text?.startsWith("/")) return null;

	const parts = text.split(/\s+/);
	const command = parts[0].replace(/@\w+$/, "").toLowerCase();
	const args = parts.slice(1);

	return { command, args };
}

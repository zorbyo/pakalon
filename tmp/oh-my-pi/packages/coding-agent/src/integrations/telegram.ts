/**
 * Telegram bot integration for Pakalon.
 * Handles bot connection, message routing, and notifications.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface TelegramConfig {
	botToken: string;
	enabled: boolean;
	chatId?: string;
	webhookUrl?: string;
	createdAt: string;
}

export interface TelegramMessage {
	id: number;
	chatId: string;
	text: string;
	timestamp: string;
	from?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Storage
// ═══════════════════════════════════════════════════════════════════════════════

const TELEGRAM_FILE = path.join(process.env.HOME || "", ".pakalon", "telegram.json");
const TELEGRAM_MESSAGES_DIR = path.join(process.env.HOME || "", ".pakalon", "telegram-messages");

function ensureDir(): void {
	const dir = path.dirname(TELEGRAM_FILE);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get Telegram configuration.
 */
export function getTelegramConfig(): TelegramConfig | null {
	try {
		const raw = fs.readFileSync(TELEGRAM_FILE, "utf-8");
		return JSON.parse(raw) as TelegramConfig;
	} catch {
		return null;
	}
}

/**
 * Save Telegram configuration.
 */
export function saveTelegramConfig(config: TelegramConfig): void {
	ensureDir();
	fs.writeFileSync(TELEGRAM_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
	logger.info("Telegram config saved", { enabled: config.enabled });
}

/**
 * Check if Telegram is connected.
 */
export function isTelegramConnected(): boolean {
	const config = getTelegramConfig();
	return config?.enabled ?? false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Connection management
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Connect to Telegram bot.
 */
export function connectTelegram(botToken: string): { success: boolean; message: string } {
	// Validate token format (basic check)
	if (!botToken || botToken.length < 40) {
		return { success: false, message: "Invalid bot token format" };
	}

	const config: TelegramConfig = {
		botToken,
		enabled: true,
		createdAt: new Date().toISOString(),
	};

	saveTelegramConfig(config);
	return { success: true, message: "Telegram bot connected successfully" };
}

/**
 * Disconnect Telegram bot.
 */
export function disconnectTelegram(): { success: boolean; message: string } {
	try {
		fs.unlinkSync(TELEGRAM_FILE);
		logger.info("Telegram disconnected");
		return { success: true, message: "Telegram bot disconnected" };
	} catch {
		return { success: false, message: "No Telegram connection to disconnect" };
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Message handling
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Send a message via Telegram bot.
 */
export async function sendTelegramMessage(
	chatId: string,
	text: string,
): Promise<{ success: boolean; messageId?: number; error?: string }> {
	const config = getTelegramConfig();
	if (!config?.enabled) {
		return { success: false, error: "Telegram not connected" };
	}

	try {
		// Use Telegram Bot API directly
		const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				chat_id: chatId,
				text,
				parse_mode: "Markdown",
			}),
		});

		const data = (await response.json()) as { ok: boolean; result?: { message_id: number }; description?: string };

		if (!data.ok) {
			return { success: false, error: data.description || "Failed to send message" };
		}

		// Log message
		logMessage({
			id: data.result?.message_id ?? 0,
			chatId,
			text,
			timestamp: new Date().toISOString(),
		});

		return { success: true, messageId: data.result?.message_id };
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		return { success: false, error: errMsg };
	}
}

/**
 * Send a notification to the configured chat.
 */
export async function sendNotification(text: string): Promise<{ success: boolean; error?: string }> {
	const config = getTelegramConfig();
	if (!config?.chatId) {
		return { success: false, error: "No chat ID configured" };
	}

	return sendTelegramMessage(config.chatId, text);
}

/**
 * Send a code change notification.
 */
export async function notifyCodeChange(
	files: string[],
	summary: string,
): Promise<{ success: boolean; error?: string }> {
	const fileList = files.map(f => `- \`${f}\``).join("\n");
	const text = `📝 *Code Change*\n\n${summary}\n\nFiles:\n${fileList}`;

	return sendNotification(text);
}

/**
 * Send a build status notification.
 */
export async function notifyBuildStatus(
	status: "success" | "error" | "running",
	details?: string,
): Promise<{ success: boolean; error?: string }> {
	const icon = status === "success" ? "✅" : status === "error" ? "❌" : "🔄";
	const text = `${icon} *Build ${status.charAt(0).toUpperCase() + status.slice(1)}*\n${details || ""}`;

	return sendNotification(text);
}

/**
 * Send a deployment notification.
 */
export async function notifyDeployment(
	environment: string,
	status: "started" | "completed" | "failed",
): Promise<{ success: boolean; error?: string }> {
	const icon = status === "started" ? "🚀" : status === "completed" ? "✅" : "❌";
	const text = `${icon} *Deployment ${status.charAt(0).toUpperCase() + status.slice(1)}*\nEnvironment: ${environment}`;

	return sendNotification(text);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Message logging
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Log a message to the messages directory.
 */
function logMessage(message: TelegramMessage): void {
	if (!fs.existsSync(TELEGRAM_MESSAGES_DIR)) {
		fs.mkdirSync(TELEGRAM_MESSAGES_DIR, { recursive: true });
	}

	const date = new Date().toISOString().split("T")[0];
	const filePath = path.join(TELEGRAM_MESSAGES_DIR, `${date}.jsonl`);
	const line = `${JSON.stringify(message)}\n`;
	fs.appendFileSync(filePath, line);
}

/**
 * Get recent messages.
 */
export function getRecentMessages(limit: number = 10): TelegramMessage[] {
	try {
		const files = fs
			.readdirSync(TELEGRAM_MESSAGES_DIR)
			.filter(f => f.endsWith(".jsonl"))
			.sort()
			.reverse();

		const messages: TelegramMessage[] = [];
		for (const file of files) {
			if (messages.length >= limit) break;
			const content = fs.readFileSync(path.join(TELEGRAM_MESSAGES_DIR, file), "utf-8");
			const lines = content.trim().split("\n").filter(Boolean);
			for (const line of lines) {
				messages.push(JSON.parse(line) as TelegramMessage);
				if (messages.length >= limit) break;
			}
		}

		return messages.slice(0, limit);
	} catch {
		return [];
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Bot info
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get bot information from Telegram API.
 */
export async function getBotInfo(): Promise<{
	success: boolean;
	bot?: { username: string; first_name: string };
	error?: string;
}> {
	const config = getTelegramConfig();
	if (!config?.botToken) {
		return { success: false, error: "No bot token configured" };
	}

	try {
		const response = await fetch(`https://api.telegram.org/bot${config.botToken}/getMe`);
		const data = (await response.json()) as {
			ok: boolean;
			result?: { username: string; first_name: string };
			description?: string;
		};

		if (!data.ok) {
			return { success: false, error: data.description || "Failed to get bot info" };
		}

		return { success: true, bot: data.result };
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		return { success: false, error: errMsg };
	}
}

/**
 * Format Telegram status for display.
 */
export function formatTelegramStatus(): string {
	const config = getTelegramConfig();
	if (!config) {
		return "Telegram: Not configured\n\nUse /connect <bot-token> to connect.";
	}

	const lines = [
		"Telegram Status",
		"═══════════════════════════════════════",
		`Status: ${config.enabled ? "Connected" : "Disconnected"}`,
		`Bot Token: ${config.botToken.slice(0, 10)}...`,
	];

	if (config.chatId) {
		lines.push(`Chat ID: ${config.chatId}`);
	}

	lines.push(`Connected: ${config.createdAt}`);

	return lines.join("\n");
}

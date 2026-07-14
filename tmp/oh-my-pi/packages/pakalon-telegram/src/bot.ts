import { logger } from "@oh-my-pi/pi-utils";
import type { TelegramConfig, TelegramConnectionStatus, TelegramMessage } from "./types";

export class TelegramBot {
	private config: TelegramConfig | null = null;
	private status: TelegramConnectionStatus = "disconnected";
	private messages: TelegramMessage[] = [];

	async connect(config: TelegramConfig): Promise<boolean> {
		this.config = config;
		this.status = "connecting";
		logger.info("Connecting to Telegram...");
		this.status = "connected";
		logger.info("Telegram connected");
		return true;
	}

	async disconnect(): Promise<void> {
		this.status = "disconnected";
		this.config = null;
		logger.info("Telegram disconnected");
	}

	async sendMessage(chatId: string, _text: string): Promise<boolean> {
		if (this.status !== "connected") return false;
		logger.info("Sending Telegram message", { chatId });
		return true;
	}

	async sendToConfiguredChat(text: string): Promise<boolean> {
		if (!this.config?.chatId) return false;
		return this.sendMessage(this.config.chatId, text);
	}

	receiveMessage(msg: TelegramMessage): void {
		this.messages.push(msg);
	}

	getMessages(): TelegramMessage[] {
		return [...this.messages];
	}

	getStatus(): TelegramConnectionStatus {
		return this.status;
	}

	isConnected(): boolean {
		return this.status === "connected";
	}
}

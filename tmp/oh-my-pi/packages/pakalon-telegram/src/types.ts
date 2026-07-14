import { z } from "zod";

export type TelegramConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface TelegramConfig {
	botToken: string;
	chatId?: string;
	webhookUrl?: string;
}

export interface TelegramMessage {
	id: string;
	chatId: string;
	text: string;
	from: string;
	timestamp: string;
}

export const TelegramConfigSchema = z.object({
	botToken: z.string(),
	chatId: z.string().optional(),
	webhookUrl: z.string().optional(),
});

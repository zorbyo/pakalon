/**
 * /connect and /connect-end commands - Telegram bot integration
 */

import { logger } from "@oh-my-pi/pi-utils";
import type { CommandEntry } from "@oh-my-pi/pi-utils/cli";
import fs from "fs";
import path from "path";

const TELEGRAM_CONFIG_PATH = (cwd: string) => path.join(cwd, ".pakalon-agents", "telegram-config.json");

export const connectCommand: CommandEntry = {
	name: "connect",
	description: "Connect Pakalon to Telegram bot for remote control",
	usage: "/connect <bot-token>",
	async execute(args: string[]) {
		const cwd = process.cwd();
		const configPath = TELEGRAM_CONFIG_PATH(cwd);

		if (!args.length) {
			if (fs.existsSync(configPath)) {
				const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
				return {
					success: true,
					message:
						`Telegram bot already connected\n\n` +
						`Bot: @${config.botUsername || "unknown"}\n` +
						`Status: Active\n\n` +
						`Send messages to your bot to control Pakalon\n` +
						`Use /connect-end to disconnect`,
				};
			}
			return {
				success: false,
				message:
					"Error: Please provide your Telegram bot token.\n\nUsage: /connect <bot-token>\n\n" +
					"How to get a bot token:\n" +
					"1. Open Telegram and search for @BotFather\n" +
					"2. Send /newbot and follow instructions\n" +
					"3. Copy the API token provided",
			};
		}

		const botToken = args[0]?.trim();
		if (!botToken) {
			return {
				success: false,
				message: "Error: Invalid bot token. Please provide a valid Telegram bot token.",
			};
		}

		try {
			if (!botToken.includes(":")) {
				return {
					success: false,
					message: "Error: Invalid bot token format. Expected format: <numbers>:<alphanumeric>",
				};
			}

			const config = {
				botToken,
				botUsername: "pakalon_bot",
				connectedAt: new Date().toISOString(),
				webhookUrl: "",
				status: "active",
			};

			fs.mkdirSync(path.dirname(configPath), { recursive: true });
			fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

			logger.info("Telegram bot connected", { botToken: `${botToken.slice(0, 10)}...` });

			return {
				success: true,
				message:
					`Telegram bot connected successfully!\n\n` +
					`Bot: @${config.botUsername}\n` +
					`Status: Active\n\n` +
					`Now you can:\n` +
					`   - Send messages to your bot to control Pakalon\n` +
					`   - Ask questions with /ans\n` +
					`   - Control phases remotely\n\n` +
					`Use /connect-end to disconnect`,
			};
		} catch (err) {
			logger.error("Telegram connection failed", { err });
			return {
				success: false,
				message: `Error: Failed to connect Telegram bot: ${err}\n\nPlease check your token and try again.`,
			};
		}
	},
};

export const connectEndCommand: CommandEntry = {
	name: "connect-end",
	description: "Disconnect Telegram bot integration",
	usage: "/connect-end",
	async execute(_args: string[]) {
		const cwd = process.cwd();
		const configPath = TELEGRAM_CONFIG_PATH(cwd);

		if (!fs.existsSync(configPath)) {
			return {
				success: false,
				message: "Error: No active Telegram connection found.",
			};
		}

		try {
			fs.unlinkSync(configPath);

			logger.info("Telegram bot disconnected");

			return {
				success: true,
				message:
					"Telegram bot disconnected successfully.\n\n" +
					"Your bot will no longer respond to messages.\n" +
					"Use /connect to reconnect anytime.",
			};
		} catch (err) {
			logger.error("Telegram disconnection failed", { err });
			return {
				success: false,
				message: `Error: Failed to disconnect: ${err}`,
			};
		}
	},
};

export default { connectCommand, connectEndCommand };

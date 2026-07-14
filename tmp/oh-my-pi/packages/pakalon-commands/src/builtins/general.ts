import type { SlashCommand } from "../types";

export const HELP_COMMAND: SlashCommand = {
	id: "help",
	name: "help",
	aliases: ["h", "?"],
	description: "Show available commands and usage",
	category: "general",
	usage: "/help [command]",
	handler: async (_args, _ctx) => ({
		success: true,
		message: "Available commands: /help, /clear, /init, /model, /plan, /edit, /compact",
	}),
};

export const CLEAR_COMMAND: SlashCommand = {
	id: "clear",
	name: "clear",
	aliases: ["cls"],
	description: "Clear the terminal screen",
	category: "general",
	usage: "/clear",
	handler: async () => ({
		success: true,
		message: "Screen cleared.",
	}),
};

export const EXIT_COMMAND: SlashCommand = {
	id: "exit",
	name: "exit",
	aliases: ["q", "quit"],
	description: "Exit the application",
	category: "general",
	usage: "/exit",
	handler: async () => ({
		success: true,
		message: "Goodbye!",
	}),
};

export const GENERAL_COMMANDS: SlashCommand[] = [HELP_COMMAND, CLEAR_COMMAND, EXIT_COMMAND];

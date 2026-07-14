import type { SlashCommand } from "../types";

export const UNDO_COMMAND: SlashCommand = {
	id: "undo",
	name: "undo",
	aliases: ["u"],
	description: "Undo the last code or conversation change",
	category: "admin",
	usage: "/undo",
	handler: async () => ({
		success: true,
		message: "Last change undone.",
	}),
};

export const COMPACT_COMMAND: SlashCommand = {
	id: "compact",
	name: "compact",
	aliases: [],
	description: "Compact conversation context window",
	category: "admin",
	usage: "/compact",
	handler: async () => ({
		success: true,
		message: "Context compacted.",
	}),
};

export const MODELS_COMMAND: SlashCommand = {
	id: "models",
	name: "models",
	aliases: ["model"],
	description: "List and switch between available models",
	category: "admin",
	usage: "/models [model-name]",
	handler: async (_args, _ctx) => ({
		success: true,
		message: "Available models: (auto-detect)",
	}),
};

export const AUDITOR_COMMAND: SlashCommand = {
	id: "auditor",
	name: "auditor",
	aliases: ["audit"],
	description: "Run code audit and quality check",
	category: "admin",
	usage: "/auditor",
	handler: async () => ({
		success: true,
		message: "Auditor started.",
	}),
};

export const ADMIN_COMMANDS: SlashCommand[] = [UNDO_COMMAND, COMPACT_COMMAND, MODELS_COMMAND, AUDITOR_COMMAND];

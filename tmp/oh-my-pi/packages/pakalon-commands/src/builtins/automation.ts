import type { SlashCommand } from "../types";

export const AGENTS_COMMAND: SlashCommand = {
	id: "agents",
	name: "agents",
	aliases: ["agent"],
	description: "Manage agent teams",
	category: "agent",
	usage: "/agents [list|create|remove]",
	handler: async (args, _ctx) => ({
		success: true,
		message: args ? `Agent command: ${args}` : "Agent teams manager opened.",
	}),
};

export const WORKFLOWS_COMMAND: SlashCommand = {
	id: "workflows",
	name: "workflows",
	aliases: ["wf"],
	description: "List and manage saved workflows",
	category: "automation",
	usage: "/workflows",
	handler: async () => ({
		success: true,
		message: "Workflows: (none configured)",
	}),
};

export const AUTOMATIONS_COMMAND: SlashCommand = {
	id: "automations",
	name: "automations",
	aliases: ["auto"],
	description: "Manage automation workflows (cron, GitHub, Slack)",
	category: "automation",
	usage: "/automations [list|add|remove|run]",
	handler: async (args, _ctx) => ({
		success: true,
		message: args ? `Automation command: ${args}` : "Automation manager opened.",
	}),
};

export const PLUGINS_COMMAND: SlashCommand = {
	id: "plugins",
	name: "plugins",
	aliases: ["plugin"],
	description: "Manage plugins",
	category: "admin",
	usage: "/plugins [list|install|remove]",
	handler: async (args, _ctx) => ({
		success: true,
		message: args ? `Plugin command: ${args}` : "Plugin manager opened.",
	}),
};

export const PENPOT_COMMAND: SlashCommand = {
	id: "penpot",
	name: "penpot",
	aliases: [],
	description: "Open Penpot design tool for wireframing",
	category: "tools",
	usage: "/penpot",
	handler: async () => ({
		success: true,
		message: "Opening Penpot...",
	}),
};

export const UPDATE_COMMAND: SlashCommand = {
	id: "update",
	name: "update",
	aliases: [],
	description: "Apply design changes (e.g. /update navbar rounded)",
	category: "tools",
	usage: "/update <description>",
	handler: async (args, _ctx) => ({
		success: true,
		message: `Updating design: ${args}`,
	}),
};

export const CONNECT_COMMAND: SlashCommand = {
	id: "connect",
	name: "connect",
	aliases: [],
	description: "Connect Telegram bot integration",
	category: "automation",
	usage: "/connect [telegram-bot-token]",
	handler: async (_args, _ctx) => ({
		success: true,
		message: "Telegram connection initiated.",
	}),
};

export const CONNECT_END_COMMAND: SlashCommand = {
	id: "connect-end",
	name: "connect-end",
	aliases: ["disconnect"],
	description: "Disconnect Telegram bot integration",
	category: "automation",
	usage: "/connect-end",
	handler: async () => ({
		success: true,
		message: "Telegram disconnected.",
	}),
};

export const AUTOMATION_COMMANDS: SlashCommand[] = [
	AGENTS_COMMAND,
	WORKFLOWS_COMMAND,
	AUTOMATIONS_COMMAND,
	PLUGINS_COMMAND,
	PENPOT_COMMAND,
	UPDATE_COMMAND,
	CONNECT_COMMAND,
	CONNECT_END_COMMAND,
];

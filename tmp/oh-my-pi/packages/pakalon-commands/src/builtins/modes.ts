import type { SlashCommand } from "../types";

export const PLAN_COMMAND: SlashCommand = {
	id: "plan",
	name: "plan",
	aliases: [],
	description: "Switch to Plan mode (read-only planning)",
	category: "mode",
	usage: "/plan",
	handler: async () => ({
		success: true,
		message: "Switched to Plan mode. Agent will plan without executing destructive actions.",
	}),
};

export const EDIT_COMMAND: SlashCommand = {
	id: "edit",
	name: "edit",
	aliases: [],
	description: "Switch to Edit mode (requires confirmation)",
	category: "mode",
	usage: "/edit",
	handler: async () => ({
		success: true,
		message: "Switched to Edit mode. File edits require confirmation.",
	}),
};

export const MODE_COMMANDS: SlashCommand[] = [PLAN_COMMAND, EDIT_COMMAND];

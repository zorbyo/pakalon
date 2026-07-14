import type { SlashCommand } from "../types";

export const SESSIONS_COMMAND: SlashCommand = {
	id: "sessions",
	name: "sessions",
	aliases: ["session"],
	description: "Browse and manage saved sessions",
	category: "session",
	usage: "/sessions [list|resume|delete]",
	handler: async (args, _ctx) => {
		if (args === "list") {
			return { success: true, message: "Saved sessions: (no sessions)", data: { sessions: [] } };
		}
		return { success: true, message: "Session manager opened." };
	},
};

export const RESUME_COMMAND: SlashCommand = {
	id: "resume",
	name: "resume",
	aliases: [],
	description: "Resume a previous session",
	category: "session",
	usage: "/resume [session_id]",
	handler: async (args, _ctx) => ({
		success: true,
		message: args ? `Resuming session: ${args}` : "Resuming last session.",
	}),
};

export const NEW_COMMAND: SlashCommand = {
	id: "new",
	name: "new",
	aliases: [],
	description: "Start a new session",
	category: "session",
	usage: "/new",
	handler: async () => ({
		success: true,
		message: "New session started.",
	}),
};

export const HISTORY_COMMAND: SlashCommand = {
	id: "history",
	name: "history",
	aliases: ["hist"],
	description: "Show prompts and changes history",
	category: "session",
	usage: "/history",
	handler: async () => ({
		success: true,
		message: "History: (not implemented)",
	}),
};

export const SESSION_COMMANDS: SlashCommand[] = [SESSIONS_COMMAND, RESUME_COMMAND, NEW_COMMAND, HISTORY_COMMAND];

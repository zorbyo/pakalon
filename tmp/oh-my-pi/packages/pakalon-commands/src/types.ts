import { z } from "zod";

export type CommandCategory = "general" | "mode" | "phase" | "agent" | "session" | "admin" | "tools" | "automation";

export interface SlashCommand {
	id: string;
	name: string;
	aliases: string[];
	description: string;
	category: CommandCategory;
	usage: string;
	handler: (args: string, context: CommandContext) => Promise<CommandResult>;
}

export interface CommandContext {
	cwd: string;
	mode: "HIL" | "YOLO";
	userId?: string;
}

export interface CommandResult {
	success: boolean;
	message: string;
	data?: Record<string, unknown>;
}

export const SlashCommandSchema = z.object({
	id: z.string(),
	name: z.string(),
	aliases: z.array(z.string()),
	description: z.string(),
	category: z.enum(["general", "mode", "phase", "agent", "session", "admin", "tools", "automation"]),
	usage: z.string(),
});

import { logger } from "@oh-my-pi/pi-utils";
import type { CommandCategory, CommandContext, CommandResult, SlashCommand } from "./types";

export class CommandRegistry {
	private commands: Map<string, SlashCommand> = new Map();

	register(command: SlashCommand): void {
		this.commands.set(command.id, command);
		for (const alias of command.aliases) {
			this.commands.set(alias, command);
		}
	}

	registerMany(commands: SlashCommand[]): void {
		for (const cmd of commands) {
			this.register(cmd);
		}
	}

	get(id: string): SlashCommand | undefined {
		return this.commands.get(id);
	}

	getAll(): SlashCommand[] {
		const seen = new Set<string>();
		const result: SlashCommand[] = [];
		for (const cmd of this.commands.values()) {
			if (!seen.has(cmd.id)) {
				seen.add(cmd.id);
				result.push(cmd);
			}
		}
		return result;
	}

	getByCategory(category: CommandCategory): SlashCommand[] {
		return this.getAll().filter(c => c.category === category);
	}

	async execute(idOrAlias: string, args: string, context: CommandContext): Promise<CommandResult> {
		const cmd = this.get(idOrAlias);
		if (!cmd) {
			return { success: false, message: `Unknown command: /${idOrAlias}` };
		}
		try {
			logger.debug("Executing command", { command: cmd.id, args });
			return await cmd.handler(args, context);
		} catch (error) {
			logger.error("Command execution failed", { command: cmd.id, error });
			return { success: false, message: `Command /${cmd.name} failed: ${error}` };
		}
	}

	remove(id: string): boolean {
		return this.commands.delete(id);
	}

	clear(): void {
		this.commands.clear();
	}

	count(): number {
		const seen = new Set<string>();
		for (const cmd of this.commands.values()) {
			seen.add(cmd.id);
		}
		return seen.size;
	}
}

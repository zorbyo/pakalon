/**
 * Help Command for Pakalon CLI
 *
 * Keeps command help in sync with the live slash-command registry.
 */

import type { CommandContext, CommandResult } from "./types.js";
import {
  formatSlashCommandHelp,
  formatSlashHelpOverview,
  getAllSlashCommands,
  getSlashCommand,
} from "./slash-registry.js";

export interface CommandInfo {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string;
  category?: string;
  hidden?: boolean;
}

export interface ToolInfo {
  name: string;
  description: string;
  category?: string;
  isReadOnly?: boolean;
}

export interface HelpCategory {
  name: string;
  description: string;
  commands: CommandInfo[];
}

const commandRegistry: Map<string, CommandInfo> = new Map();

function toCommandInfo(): CommandInfo[] {
  return getAllSlashCommands().map((command) => ({
    name: command.name,
    aliases: command.aliases,
    description: command.description,
    usage: command.usage,
    category: command.category,
    hidden: command.hidden,
  }));
}

export function registerCommand(info: CommandInfo): void {
  commandRegistry.set(info.name.toLowerCase(), info);
  for (const alias of info.aliases ?? []) {
    commandRegistry.set(alias.toLowerCase(), { ...info, name: alias });
  }
}

export function getCommand(name: string): CommandInfo | undefined {
  const normalized = name.toLowerCase().replace(/^\//, "");
  const custom = commandRegistry.get(normalized);
  if (custom) return custom;

  const builtin = getSlashCommand(normalized);
  if (!builtin) return undefined;
  return {
    name: builtin.name,
    aliases: builtin.aliases,
    description: builtin.description,
    usage: builtin.usage,
    category: builtin.category,
    hidden: builtin.hidden,
  };
}

export function getAllCommands(): CommandInfo[] {
  const commands = new Map<string, CommandInfo>();

  for (const command of toCommandInfo()) {
    if (!command.hidden) {
      commands.set(command.name, command);
    }
  }

  for (const [, command] of commandRegistry) {
    if (!command.hidden) {
      commands.set(command.name, command);
    }
  }

  return [...commands.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function formatCommandList(commands: CommandInfo[]): string {
  const grouped = new Map<string, CommandInfo[]>();

  for (const command of commands) {
    const category = command.category ?? "other";
    if (!grouped.has(category)) {
      grouped.set(category, []);
    }
    grouped.get(category)!.push(command);
  }

  const lines: string[] = [];
  for (const [category, items] of grouped) {
    lines.push(category, "-".repeat(category.length));
    for (const command of items.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`  /${command.name} - ${command.description}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function formatCommandHelp(cmd: CommandInfo): string {
  return formatSlashCommandHelp(cmd.name);
}

export function formatHelpOverview(): string {
  return formatSlashHelpOverview();
}

export const helpCommand = {
  name: "help",
  aliases: ["h", "?"],
  description: "Show help information",
  usage: "/help [command]",
  category: "info",

  async execute(_context: CommandContext, args: string[]): Promise<CommandResult> {
    const commandName = args[0];
    if (commandName) {
      const cmd = getCommand(commandName);
      if (!cmd) {
        return {
          success: false,
          message: `Unknown command: ${commandName}\n\nRun /help for a list of commands.`,
        };
      }

      return {
        success: true,
        message: formatCommandHelp(cmd),
      };
    }

    return {
      success: true,
      message: formatHelpOverview(),
    };
  },
};

export default {
  helpCommand,
  registerCommand,
  getCommand,
  getAllCommands,
  formatCommandList,
  formatCommandHelp,
  formatHelpOverview,
};

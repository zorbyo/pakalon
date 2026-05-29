/**
 * Skill Tool Commands
 *
 * Provides infrastructure for creating slash commands from skill frontmatter.
 * When a skill defines `allowed-tools`, those tools are made available as
 * permission overrides during skill execution.
 *
 * This module bridges the gap between skill definitions (which are slash
 * commands like /verify) and the tool system (which needs tool definitions
 * for the model to invoke).
 *
 * Currently a placeholder for the SkillTool integration that will allow
 * the model to invoke skills as tools during conversation via
 * a dedicated "skill" tool.
 */

import type { Command } from "@/types-imported/command.js";

/**
 * Wraps a skill command so it can be invoked as a skill tool.
 * Returns the same command but with explicit skill tool metadata.
 *
 * @param command The skill command to wrap
 * @param allowedTools Tools the skill is allowed to use
 * @returns The same command with skill tool annotations
 */
export function createSkillToolCommand(
  command: Command,
  allowedTools?: string[],
): Command {
  if (command.type !== "prompt") return command;

  return {
    ...command,
    allowedTools:
      allowedTools ??
      command.allowedTools,
    // Mark as a skill tool so the system knows it can be invoked by name
    // from the "skill" tool
    aliases: [...(command.aliases ?? []), `skill:${command.name}`],
  };
}

/**
 * Get the allowed tools for a skill command.
 * Returns undefined if the skill has no tool restrictions.
 *
 * @param command The skill command
 * @returns Array of allowed tool names, or undefined if unrestricted
 */
export function getSkillAllowedTools(
  command: Command,
): string[] | undefined {
  if (command.type !== "prompt") return undefined;
  return command.allowedTools;
}

/**
 * Check if a skill has tool restrictions.
 *
 * @param command The skill command
 * @returns True if the skill has explicit allowed-tools
 */
export function hasSkillToolRestrictions(command: Command): boolean {
  const tools = getSkillAllowedTools(command);
  return tools !== undefined && tools.length > 0;
}

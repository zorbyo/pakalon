/**
 * /workflows command — Main command handler for workflow management.
 * Sub-commands: save, list, run, delete, show
 */
import type { CommandContext, CommandResult } from "@/commands/types.js";
import { saveWorkflowCommand } from "./save.js";
import { listWorkflowsCommand } from "./list.js";
import { runWorkflowCommand } from "./execute.js";
import { deleteWorkflowCommand } from "./delete.js";
import { getWorkflowDetails, listWorkflows } from "@/workflows/workflowManager.js";

const SUB_COMMANDS = ["save", "list", "run", "delete", "show"] as const;
type SubCommand = (typeof SUB_COMMANDS)[number];

export const workflowsCommand = {
  name: "workflows",
  aliases: ["wf"],
  description: "Manage saved workflows — save, list, run, and delete reusable prompt sequences",
  usage: "/workflows [save|list|run|delete|show] [args...]",
  category: "workflow",

  async execute(context: CommandContext, args: string[]): Promise<CommandResult> {
    const subCommand = (args[0] ?? "list") as SubCommand;
    const subArgs = args.slice(1);

    switch (subCommand) {
      case "save":
        return saveWorkflowCommand(context, subArgs);

      case "list":
        return listWorkflowsCommand(context, subArgs);

      case "run":
        return runWorkflowCommand(context, subArgs);

      case "delete":
        return deleteWorkflowCommand(context, subArgs);

      case "show": {
        if (subArgs.length === 0) {
          return {
            success: false,
            message: "Usage: /workflows show <name>\n\nProvide the name of the workflow to view.",
          };
        }
        const name = subArgs[0]!;
        const wf = getWorkflowDetails(name);
        if (!wf) {
          return {
            success: false,
            message: `Workflow "${name}" not found.`,
          };
        }

        const lines: string[] = [
          `── Workflow: ${wf.name} ${"─".repeat(Math.max(0, 40 - wf.name.length))}`,
          "",
          `  ID:          ${wf.id}`,
          `  Description: ${wf.description || "(none)"}`,
          `  Tags:        ${(wf.tags ?? []).join(", ") || "(none)"}`,
          `  Created:     ${new Date(wf.createdAt).toLocaleString()}`,
        ];
        if (wf.updatedAt) lines.push(`  Updated:     ${new Date(wf.updatedAt).toLocaleString()}`);
        if (wf.lastUsedAt) lines.push(`  Last used:   ${new Date(wf.lastUsedAt).toLocaleString()}`);
        if (wf.schedule) {
          lines.push(`  Schedule:    ${wf.schedule.cron}${wf.schedule.enabled ? "" : " (disabled)"}  ${wf.schedule.description ?? ""}`);
        }

        const steps = wf.steps.length ? wf.steps : wf.prompts.map((p) => ({ type: "prompt", content: p, label: p.slice(0, 60) }));
        lines.push(`\n  Steps (${steps.length}):`);
        steps.forEach((step, i) => {
          const label = step.label || step.content?.slice(0, 70) || step.command || step.tool || "";
          lines.push(`    ${String(i + 1).padStart(2)}. [${(step.type as string).padEnd(6)}] ${label}`);
        });

        return {
          success: true,
          message: lines.join("\n"),
          data: { workflow: wf },
        };
      }

      default:
        return {
          success: false,
          message: `Unknown sub-command: ${subCommand}\n\nAvailable: ${SUB_COMMANDS.join(", ")}\nUsage: /workflows [${SUB_COMMANDS.join("|")}]`,
        };
    }
  },

  complete(partial: string, _context: CommandContext): string[] {
    if (!partial) {
      return [...SUB_COMMANDS];
    }
    return SUB_COMMANDS.filter((cmd) => cmd.startsWith(partial.toLowerCase()));
  },
};

export default workflowsCommand;

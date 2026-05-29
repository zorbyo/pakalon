/**
 * /workflows delete — Delete a saved workflow.
 */
import type { CommandContext, CommandResult } from "@/commands/types.js";
import { removeWorkflow } from "@/workflows/workflowManager.js";

export async function deleteWorkflowCommand(_context: CommandContext, args: string[]): Promise<CommandResult> {
  if (args.length === 0) {
    return {
      success: false,
      message: "Usage: /workflows delete <name>\n\nProvide the name of the workflow to delete.",
    };
  }

  const name = args[0]!;
  const result = removeWorkflow(name);

  return {
    success: result.success,
    message: result.message,
  };
}

/**
 * /workflows save — Save current chat session as a reusable workflow.
 */
import type { CommandContext, CommandResult } from "@/commands/types.js";
import { saveWorkflowFromMessages } from "@/workflows/workflowManager.js";
import { debugLog } from "@/utils/logger.js";

export async function saveWorkflowCommand(context: CommandContext, args: string[]): Promise<CommandResult> {
  if (args.length === 0) {
    return {
      success: false,
      message: "Usage: /workflows save <name> [description]\n\nProvide a name for the workflow. Optionally add a description.",
    };
  }

  const name = args[0]!;
  const description = args.slice(1).join(" ") || `Workflow: ${name}`;

  const messages = (context.messages ?? []) as Array<{ role?: string; content?: string }>;

  if (messages.length === 0) {
    return {
      success: false,
      message: "No messages in current session to save as workflow.",
    };
  }

  try {
    const workflow = saveWorkflowFromMessages(name, description, messages);
    debugLog(`[workflows:save] Saved workflow "${name}" with ${workflow.steps.length} steps`);

    return {
      success: true,
      message: `[OK] Workflow "${name}" saved with ${workflow.steps.length} step(s).\nDescription: ${workflow.description}`,
      data: { workflow },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to save workflow: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

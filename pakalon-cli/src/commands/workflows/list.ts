/**
 * /workflows list — List all saved workflows.
 */
import type { CommandContext, CommandResult } from "@/commands/types.js";
import { listWorkflows } from "@/workflows/workflowManager.js";

export async function listWorkflowsCommand(_context: CommandContext, _args: string[]): Promise<CommandResult> {
  const workflows = listWorkflows();

  if (workflows.length === 0) {
    return {
      success: true,
      message: "No workflows saved.\nSave a workflow with: /workflows save <name>",
    };
  }

  const lines: string[] = [
    `── Saved Workflows (${workflows.length}) ─────────────────────`,
    "",
  ];

  for (const wf of workflows) {
    const lastUsed = wf.lastUsedAt
      ? new Date(wf.lastUsedAt).toLocaleDateString()
      : "Never";
    const stepCount = wf.steps.length || wf.prompts.length;
    const tags = wf.tags?.length ? ` [${wf.tags.join(", ")}]` : "";

    lines.push(`  ${wf.name.padEnd(30)} ${stepCount} step(s)  Last used: ${lastUsed}${tags}`);
    if (wf.description) {
      lines.push(`    ${wf.description}`);
    }
    lines.push("");
  }

  return {
    success: true,
    message: lines.join("\n").trimEnd(),
    data: { workflows, count: workflows.length },
  };
}

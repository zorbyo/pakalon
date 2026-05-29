/**
 * /workflows run — Execute a saved workflow.
 */
import type { CommandContext, CommandResult } from "@/commands/types.js";
import { executeWorkflow, getWorkflowDetails } from "@/workflows/workflowManager.js";
import type { WorkflowStep } from "@/workflows/types.js";

export async function runWorkflowCommand(context: CommandContext, args: string[]): Promise<CommandResult> {
  if (args.length === 0) {
    return {
      success: false,
      message: "Usage: /workflows run <name>\n\nProvide the name of the workflow to execute.",
    };
  }

  const name = args[0]!;
  const wf = getWorkflowDetails(name);

  if (!wf) {
    return {
      success: false,
      message: `Workflow "${name}" not found.\nList workflows with: /workflows list`,
    };
  }

  const onStep = async (step: WorkflowStep, index: number, total: number): Promise<string | void> => {
    const stepLabel = step.label || step.content?.slice(0, 60) || step.command || step.tool || `Step ${index + 1}`;
    console.log(`  [${index + 1}/${total}] ${step.type}: ${stepLabel}`);

    if (step.type === "prompt" && step.content) {
      return step.content;
    }
    return undefined;
  };

  try {
    const result = await executeWorkflow(name, onStep);

    if (!result.ok) {
      return {
        success: false,
        message: result.error ?? "Workflow execution failed.",
      };
    }

    const promptSteps = result.stepResults.filter(
      (s) => s.step.type === "prompt" && s.result,
    );

    if (promptSteps.length === 0) {
      return {
        success: true,
        message: `Workflow "${name}" executed (${result.stepResults.length} step(s) completed).`,
        data: { results: result.results },
      };
    }

    const lines: string[] = [
      `Workflow "${name}" executed — ${promptSteps.length} prompt step(s):`,
      "",
    ];

    for (const s of promptSteps) {
      lines.push(`  ${s.index + 1}. ${s.result}`);
    }

    return {
      success: true,
      message: lines.join("\n"),
      data: { results: result.results, promptSteps },
    };
  } catch (error) {
    return {
      success: false,
      message: `Workflow execution error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

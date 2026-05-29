/**
 * Core Workflow Manager
 * Orchestrates workflow CRUD operations and execution.
 */
import type { Workflow, WorkflowStep, WorkflowResult, StepType } from "./types.js";
import {
  readWorkflows,
  writeWorkflows,
  saveWorkflow,
  deleteWorkflow,
  getWorkflow,
  markWorkflowUsed,
} from "./storage.js";
import { debugLog } from "@/utils/logger.js";

export function listWorkflows(): Workflow[] {
  return readWorkflows();
}

export function createWorkflow(
  name: string,
  description: string,
  steps: WorkflowStep[],
  tags?: string[],
): Workflow {
  const existing = getWorkflow(name);

  const workflow: Workflow = {
    id: existing?.id ?? `wf_${Date.now()}`,
    name,
    description,
    steps,
    prompts: steps.filter((s) => s.type === "prompt").map((s) => s.content ?? ""),
    tags,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  saveWorkflow(workflow);
  debugLog(`[workflowManager] Created/updated workflow: ${name}`);
  return workflow;
}

export function saveWorkflowFromMessages(
  name: string,
  description: string,
  messages: unknown[],
): Workflow {
  const userMessages = (messages as Array<{ role?: string; content?: string }>)
    .filter((m) => m.role === "user")
    .map((m) => m.content ?? "")
    .filter(Boolean);

  const steps: WorkflowStep[] = userMessages.map((content) => ({
    type: "prompt" as StepType,
    content,
    label: content.slice(0, 60),
  }));

  return createWorkflow(name, description, steps);
}

export function removeWorkflow(name: string): { success: boolean; message: string } {
  const workflow = getWorkflow(name);
  if (!workflow) {
    return { success: false, message: `Workflow "${name}" not found.` };
  }

  const deleted = deleteWorkflow(name);
  if (!deleted) {
    return { success: false, message: `Failed to delete workflow "${name}".` };
  }

  return { success: true, message: `Workflow "${name}" deleted.` };
}

export async function executeWorkflow(
  name: string,
  onStep?: (step: WorkflowStep, index: number, total: number) => Promise<string | void>,
): Promise<WorkflowResult> {
  const wf = getWorkflow(name);
  if (!wf) {
    return {
      ok: false,
      error: `Workflow "${name}" not found.`,
      results: [],
      stepResults: [],
    };
  }

  markWorkflowUsed(name);
  const results: string[] = [];
  const stepResults: Array<{ step: WorkflowStep; index: number; result?: string; error?: string }> = [];

  for (let i = 0; i < wf.steps.length; i++) {
    const step = wf.steps[i]!;
    try {
      if (step.type === "shell" && step.command) {
        const { execSync } = await import("child_process");
        const out = execSync(step.command, { encoding: "utf-8", timeout: 30_000 });
        const trimmed = out.trim();
        results.push(trimmed);
        stepResults.push({ step, index: i, result: trimmed });
      } else {
        const result = onStep ? await onStep(step, i, wf.steps.length) : undefined;
        if (typeof result === "string") {
          results.push(result);
          stepResults.push({ step, index: i, result });
        } else {
          stepResults.push({ step, index: i });
        }
      }
    } catch (err: any) {
      const errorMsg = `Step ${i + 1}: ${err.message}`;
      results.push(`[error] ${errorMsg}`);
      stepResults.push({ step, index: i, error: errorMsg });
    }
  }

  debugLog(`[workflowManager] Executed workflow: ${name} (${wf.steps.length} steps)`);
  return { ok: true, results, stepResults };
}

export function getWorkflowDetails(name: string): Workflow | null {
  return getWorkflow(name);
}

export function scheduleWorkflow(
  name: string,
  cron: string | null,
  scheduleDescription?: string,
): boolean {
  const workflows = readWorkflows();
  const idx = workflows.findIndex((w) => w.name.toLowerCase() === name.toLowerCase());
  if (idx === -1) return false;

  if (cron === null) {
    delete workflows[idx]!.schedule;
  } else {
    workflows[idx]!.schedule = {
      cron,
      description: scheduleDescription,
      enabled: true,
    };
  }

  writeWorkflows(workflows);
  return true;
}

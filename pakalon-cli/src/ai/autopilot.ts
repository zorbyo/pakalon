/**
 * Autopilot Mode — agent runs autonomously until task_complete summary.
 *
 * Matches Copilot CLI's autopilot pattern:
 * - Agent continues executing tools without user intervention
 * - Generates task_complete summary when done
 * - Summary rendered as markdown
 * - Configurable max steps
 *
 * Autopilot mode:
 * 1. Agent receives a task
 * 2. Executes tools in a loop (maxSteps limit)
 * 3. When task is complete, generates summary
 * 4. Returns control to user
 */
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutopilotConfig {
  /** Maximum number of tool execution steps */
  maxSteps: number;
  /** Maximum turns (LLM calls) before stopping */
  maxTurns: number;
  /** Whether to require task_complete summary at end */
  requireSummary: boolean;
  /** Timeout in ms */
  timeoutMs: number;
}

export interface AutopilotState {
  taskId: string;
  status: "pending" | "running" | "complete" | "error" | "timeout";
  stepsExecuted: number;
  turnsExecuted: number;
  startedAt: string;
  completedAt?: string;
  summary?: string;
  error?: string;
}

export interface AutopilotResult {
  success: boolean;
  state: AutopilotState;
  summary: string;
  stepsExecuted: number;
  turnsExecuted: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Default Config
// ---------------------------------------------------------------------------

export const DEFAULT_AUTOPILOT_CONFIG: AutopilotConfig = {
  maxSteps: 50,
  maxTurns: 20,
  requireSummary: true,
  timeoutMs: 300000, // 5 minutes
};

// ---------------------------------------------------------------------------
// Task Complete Detection
// ---------------------------------------------------------------------------

/**
 * Check if an agent response indicates task completion.
 */
export function isTaskComplete(response: string): boolean {
  const indicators = [
    /\btask\s*(is\s*)?complete\b/i,
    /\btask_complete\b/i,
    /\bdone\b/i,
    /\bfinished\b/i,
    /\bcompleted\s+successfully\b/i,
    /\ball\s+tasks?\s+(are|is)\s+(complete|done|finished)\b/i,
    /\bno\s+more\s+(work|tasks|actions)\s+(needed|required)\b/i,
  ];

  return indicators.some((pattern) => pattern.test(response));
}

/**
 * Extract task_complete summary from agent response.
 */
export function extractTaskSummary(response: string): string | null {
  // Check for explicit task_complete marker
  const taskCompleteMatch = response.match(/task_complete[:\s]*\n([\s\S]*?)(?:\n---|\n##|\Z)/i);
  if (taskCompleteMatch) {
    return taskCompleteMatch[1]?.trim() ?? null;
  }

  // Check for summary section
  const summaryMatch = response.match(/##\s*(?:Summary|Task Summary|Completion Summary)\s*\n([\s\S]*?)(?:\n##|\Z)/i);
  if (summaryMatch) {
    return summaryMatch[1]?.trim() ?? null;
  }

  return null;
}

/**
 * Generate a task_complete summary from tool execution history.
 */
export function generateTaskSummary(
  taskDescription: string,
  toolExecutions: Array<{ tool: string; input: Record<string, unknown>; result: unknown }>,
  durationMs: number
): string {
  const lines: string[] = [
    "## Task Summary",
    "",
    `**Task:** ${taskDescription}`,
    `**Duration:** ${Math.round(durationMs / 1000)}s`,
    `**Tool calls:** ${toolExecutions.length}`,
    "",
    "### Actions Taken",
    "",
  ];

  for (const exec of toolExecutions) {
    const inputPreview = JSON.stringify(exec.input).slice(0, 100);
    const success = typeof exec.result === "object" && exec.result !== null && !("error" in exec.result);
    const status = success ? "[OK]" : "[X]";
    lines.push(`- ${status} \`${exec.tool}\`: ${inputPreview}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Autopilot Runner
// ---------------------------------------------------------------------------

/**
 * Run autopilot mode.
 *
 * @param config Autopilot configuration
 * @param executeStep Callback that executes one step (LLM + tool call)
 * @returns AutopilotResult
 */
export async function runAutopilot(
  config: Partial<AutopilotConfig>,
  executeStep: (state: AutopilotState) => Promise<{
    response: string;
    toolCalls: Array<{ tool: string; input: Record<string, unknown>; result: unknown }>;
    done: boolean;
  }>
): Promise<AutopilotResult> {
  const effectiveConfig: AutopilotConfig = { ...DEFAULT_AUTOPILOT_CONFIG, ...config };
  const startTime = Date.now();

  const state: AutopilotState = {
    taskId: crypto.randomUUID(),
    status: "running",
    stepsExecuted: 0,
    turnsExecuted: 0,
    startedAt: new Date().toISOString(),
  };

  logger.info("[autopilot] Starting", { taskId: state.taskId, config: effectiveConfig });

  try {
    let lastResponse = "";

    while (
      state.stepsExecuted < effectiveConfig.maxSteps &&
      state.turnsExecuted < effectiveConfig.maxTurns &&
      Date.now() - startTime < effectiveConfig.timeoutMs
    ) {
      state.turnsExecuted++;

      const stepResult = await executeStep(state);
      state.stepsExecuted += stepResult.toolCalls.length;
      lastResponse = stepResult.response;

      // Check for explicit completion
      if (stepResult.done || isTaskComplete(stepResult.response)) {
        state.status = "complete";
        break;
      }
    }

    // Timeout or limit reached
    if (state.status === "running") {
      if (Date.now() - startTime >= effectiveConfig.timeoutMs) {
        state.status = "timeout";
        logger.warn("[autopilot] Timed out", { taskId: state.taskId });
      } else {
        state.status = "complete";
        logger.info("[autopilot] Reached step/turn limit", {
          taskId: state.taskId,
          steps: state.stepsExecuted,
          turns: state.turnsExecuted,
        });
      }
    }

    state.completedAt = new Date().toISOString();

    // Extract or generate summary
    let summary = extractTaskSummary(lastResponse);
    if (!summary && effectiveConfig.requireSummary) {
      summary = lastResponse.slice(0, 500);
    }

    state.summary = summary ?? undefined;

    return {
      success: state.status === "complete",
      state,
      summary: summary ?? "Task completed.",
      stepsExecuted: state.stepsExecuted,
      turnsExecuted: state.turnsExecuted,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    state.status = "error";
    state.error = String(err);
    state.completedAt = new Date().toISOString();

    logger.error("[autopilot] Error", { taskId: state.taskId, error: String(err) });

    return {
      success: false,
      state,
      summary: `Error: ${err instanceof Error ? err.message : String(err)}`,
      stepsExecuted: state.stepsExecuted,
      turnsExecuted: state.turnsExecuted,
      durationMs: Date.now() - startTime,
    };
  }
}

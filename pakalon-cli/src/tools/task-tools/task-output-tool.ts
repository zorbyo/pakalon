import { z } from 'zod';
import { buildTool, type ToolDef } from '../tool-types.js';
import { lazySchema } from '../../utils/lazySchema.js';
import { sleep } from '../../utils/sleep.js';
import { getTaskOutputDelta } from '../../utils/task/diskOutput.js';

const inputSchema = lazySchema(() =>
  z.strictObject({
    task_id: z.string().describe('The task ID to get output from'),
    block: z.boolean().optional().default(true).describe('Whether to wait for completion'),
    timeout: z.number().min(0).max(600000).optional().default(30000).describe('Max wait time in ms'),
  }),
);

type InputSchema = ReturnType<typeof inputSchema>;

interface TaskOutput {
  task_id: string;
  task_type: string;
  status: string;
  description: string;
  output: string;
  outputFile?: string;
  outputOffset?: number;
  exitCode?: number | null;
  error?: string;
  prompt?: string;
  result?: string;
}

interface TaskOutputToolOutput {
  retrieval_status: 'success' | 'timeout' | 'not_ready';
  task: TaskOutput | null;
}

export type Output = TaskOutputToolOutput;

async function getTaskOutputData(
  task: {
    id: string;
    type?: string;
    status: string;
    description?: string;
    result?: string;
    error?: string;
    output?: string;
    outputFile?: string;
    outputOffset?: number;
    prompt?: string;
    endedAt?: number;
    createdAt?: number;
  },
  getAppState: () => Record<string, unknown>,
): Promise<TaskOutput> {
  let output = task.output || '';

  if (!output && task.outputFile) {
    try {
      const { content } = await getTaskOutputDelta(
        task.id,
        task.outputOffset ?? 0,
      );
      if (content) {
        output = content;
      }
    } catch {
      // Disk output not available yet
    }
  }

  if (!output) {
    try {
      const storedOutput = globalThis.__taskOutputs?.[task.id];
      if (storedOutput) {
        output = storedOutput;
      }
    } catch {
      // Task outputs not available
    }
  }

  const baseOutput: TaskOutput = {
    task_id: task.id,
    task_type: task.type || 'task',
    status: task.status,
    description: task.description || '',
    output,
  };

  if (task.outputFile) {
    baseOutput.outputFile = task.outputFile;
  }

  if (task.outputOffset !== undefined) {
    baseOutput.outputOffset = task.outputOffset;
  }

  if (task.error) {
    baseOutput.error = task.error;
  }

  if (task.result) {
    baseOutput.result = task.result;
  }

  if (task.prompt) {
    baseOutput.prompt = task.prompt;
  }

  if (task.endedAt && task.createdAt) {
    baseOutput.exitCode = null;
  }

  return baseOutput;
}

async function waitForTaskCompletion(
  taskId: string,
  getAppState: () => Record<string, unknown>,
  timeoutMs: number,
  abortController?: AbortController,
): Promise<{ id: string; status: string; type?: string; description?: string; result?: string; error?: string; output?: string; prompt?: string } | null> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (abortController?.signal.aborted) {
      throw new Error('Aborted');
    }

    const state = getAppState();
    const task = state.tasks?.[taskId] as { status?: string } | undefined;

    if (!task) {
      return null;
    }

    if (task.status !== 'running' && task.status !== 'pending' && task.status !== 'in_progress') {
      const fullTask = state.tasks[taskId];
      return fullTask as { id: string; status: string; type?: string; description?: string; result?: string; error?: string; output?: string; prompt?: string } | undefined ?? null;
    }

    await sleep(100);
  }

  const finalState = getAppState();
  const task = finalState.tasks?.[taskId];
  return task as { id: string; status: string; type?: string; description?: string; result?: string; error?: string; output?: string; prompt?: string } | undefined ?? null;
}

export const TaskOutputTool = buildTool({
  name: 'TaskOutput',
  searchHint: 'read output/logs from a background task',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  aliases: ['AgentOutputTool', 'BashOutputTool'],
  userFacingName() {
    return 'Task Output';
  },
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  get outputSchema(): Output {
    return outputSchema();
  },
  async description() {
    return 'Get output from a running or completed task';
  },
  isConcurrencySafe() {
    return true;
  },
  isEnabled() {
    return true;
  },
  isReadOnly() {
    return true;
  },
  toAutoClassifierInput(input) {
    return input.task_id;
  },
  async prompt() {
    return 'Retrieves output from a running or completed task. Takes a task_id and optional block (default true) to wait for completion. Returns the task output along with status information. Task IDs can be found using the TaskList tool.';
  },
  async validateInput({ task_id }, { getAppState }) {
    if (!task_id) {
      return {
        result: false,
        message: 'Task ID is required',
        errorCode: 1,
      };
    }

    const appState = getAppState();
    const task = appState.tasks?.[task_id];

    if (!task) {
      return {
        result: false,
        message: `No task found with ID: ${task_id}`,
        errorCode: 2,
      };
    }

    return { result: true };
  },
  async call(input, context) {
    const { task_id, block = true, timeout = 30000 } = input;

    const appState = context.getAppState();
    const task = appState.tasks?.[task_id] as { status?: string; type?: string; description?: string; result?: string; error?: string; output?: string; prompt?: string; endedAt?: number; createdAt?: number } | undefined;

    if (!task) {
      throw new Error(`No task found with ID: ${task_id}`);
    }

    if (!block) {
      if (task.status !== 'running' && task.status !== 'pending' && task.status !== 'in_progress') {
        context.setAppState((prev) => {
          const tasks = prev.tasks || {};
          return {
            ...prev,
            tasks: {
              ...tasks,
              [task_id]: { ...tasks[task_id], notified: true },
            },
          };
        });
        return {
          data: {
            retrieval_status: 'success' as const,
            task: await getTaskOutputData(task as Parameters<typeof getTaskOutputData>[0], context.getAppState),
          },
        };
      }
      return {
        data: {
          retrieval_status: 'not_ready' as const,
          task: await getTaskOutputData(task as Parameters<typeof getTaskOutputData>[0], context.getAppState),
        },
      };
    }

    const completedTask = await waitForTaskCompletion(
      task_id,
      context.getAppState,
      timeout,
      context.abortController,
    );

    if (!completedTask) {
      return {
        data: {
          retrieval_status: 'timeout' as const,
          task: null,
        },
      };
    }

    if (
      completedTask.status === 'running' ||
      completedTask.status === 'pending' ||
      completedTask.status === 'in_progress'
    ) {
      return {
        data: {
          retrieval_status: 'timeout' as const,
          task: await getTaskOutputData(completedTask as Parameters<typeof getTaskOutputData>[0], context.getAppState),
        },
      };
    }

    context.setAppState((prev) => {
      const tasks = prev.tasks || {};
      return {
        ...prev,
        tasks: {
          ...tasks,
          [task_id]: { ...tasks[task_id], notified: true },
        },
      };
    });

    return {
      data: {
        retrieval_status: 'success' as const,
        task: await getTaskOutputData(completedTask as Parameters<typeof getTaskOutputData>[0], context.getAppState),
      },
    };
  },
  mapToolResultToToolResultBlockParam(data, toolUseID) {
    const parts: string[] = [];
    parts.push(`<retrieval_status>${data.retrieval_status}</retrieval_status>`);

    if (data.task) {
      parts.push(`<task_id>${data.task.task_id}</task_id>`);
      parts.push(`<task_type>${data.task.task_type}</task_type>`);
      parts.push(`<status>${data.task.status}</status>`);

      if (data.task.exitCode !== undefined && data.task.exitCode !== null) {
        parts.push(`<exit_code>${data.task.exitCode}</exit_code>`);
      }

      if (data.task.output?.trim()) {
        parts.push(`<output>\n${data.task.output.trimEnd()}\n</output>`);
      }

      if (data.task.outputFile) {
        parts.push(`<output_file>${data.task.outputFile}</output_file>`);
      }

      if (data.task.error) {
        parts.push(`<error>${data.task.error}</error>`);
      }

      if (data.task.prompt) {
        parts.push(`<prompt>${data.task.prompt}</prompt>`);
      }

      if (data.task.result) {
        parts.push(`<result>${data.task.result}</result>`);
      }
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: parts.join('\n\n'),
    };
  },
  renderToolUseMessage(input) {
    const { block = true } = input;
    if (!block) {
      return 'non-blocking';
    }
    return '';
  },
} satisfies ToolDef<InputSchema, Output>);

function outputSchema() {
  return lazySchema(() =>
    z.object({
      retrieval_status: z.enum(['success', 'timeout', 'not_ready']),
      task: z
        .object({
          task_id: z.string(),
          task_type: z.string(),
          status: z.string(),
          description: z.string(),
          output: z.string(),
          outputFile: z.string().optional(),
          outputOffset: z.number().optional(),
          exitCode: z.number().nullable().optional(),
          error: z.string().optional(),
          prompt: z.string().optional(),
          result: z.string().optional(),
        })
        .nullable(),
    }),
  )();
}

export default TaskOutputTool;
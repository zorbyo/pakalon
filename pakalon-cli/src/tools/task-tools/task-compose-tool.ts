import { z } from 'zod';
import { buildTool, type ToolDef } from '../tool-types.js';
import { lazySchema } from '../../utils/lazySchema.js';

const inputSchema = lazySchema(() =>
  z.strictObject({
    name: z.string().describe('Name for the task chain'),
    taskIds: z.array(z.string()).describe('Ordered list of task IDs to chain'),
    autoStart: z
      .boolean()
      .optional()
      .default(false)
      .describe('Automatically start the next task when current completes'),
  }),
);

type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
  z.object({
    chain: z.object({
      id: z.string(),
      name: z.string(),
      taskIds: z.array(z.string()),
      status: z.string(),
      currentTaskIndex: z.number(),
      autoStart: z.boolean(),
      createdAt: z.number(),
    }),
  }),
);

type OutputSchema = ReturnType<typeof outputSchema>;

export type Output = z.infer<OutputSchema>;

interface TaskChain {
  id: string;
  name: string;
  taskIds: string[];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  currentTaskIndex: number;
  autoStart: boolean;
  createdAt: number;
}

const taskChains = new Map<string, TaskChain>();

function generateChainId(): string {
  return `chain_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function getTask(taskId: string): { id: string; status: string; subject: string } | null {
  try {
    const state = (globalThis as Record<string, unknown>).__appState as Record<string, unknown> | undefined;
    if (state?.tasks) {
      const tasks = state.tasks as Record<string, Record<string, unknown>>;
      const t = tasks[taskId];
      if (t) {
        return {
          id: String(t.id ?? taskId),
          status: String(t.status ?? 'pending'),
          subject: String(t.subject ?? ''),
        };
      }
    }
  } catch {
    // State not available
  }
  return null;
}

function updateTaskChainStatus(chain: TaskChain): void {
  const currentTaskId = chain.taskIds[chain.currentTaskIndex];
  if (!currentTaskId) {
    chain.status = 'completed';
    return;
  }

  const task = getTask(currentTaskId);
  if (!task) {
    chain.status = 'failed';
    return;
  }

  if (task.status === 'completed') {
    if (chain.currentTaskIndex < chain.taskIds.length - 1) {
      chain.currentTaskIndex++;
      chain.status = 'running';
    } else {
      chain.status = 'completed';
    }
  } else if (task.status === 'failed') {
    chain.status = 'failed';
  } else if (task.status === 'in_progress') {
    chain.status = 'running';
  }
}

export const TaskComposeTool = buildTool({
  name: 'TaskCompose',
  searchHint: 'compose task chain',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Create and manage task chains for sequential execution';
  },
  async prompt() {
    return 'Creates a chain of tasks that execute sequentially. When one task completes, the next one can be automatically started. Useful for orchestrating multi-step workflows.';
  },
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  get outputSchema(): OutputSchema {
    return outputSchema();
  },
  userFacingName() {
    return 'TaskCompose';
  },
  shouldDefer: true,
  isEnabled() {
    return true;
  },
  isConcurrencySafe() {
    return true;
  },
  renderToolUseMessage() {
    return null;
  },
  async call({ name, taskIds, autoStart }) {
    // Validate all task IDs exist
    for (const taskId of taskIds) {
      const task = getTask(taskId);
      if (!task) {
        throw new Error(`Task #${taskId} not found`);
      }
    }

    const chainId = generateChainId();
    const chain: TaskChain = {
      id: chainId,
      name,
      taskIds,
      status: 'pending',
      currentTaskIndex: 0,
      autoStart,
      createdAt: Date.now(),
    };

    taskChains.set(chainId, chain);

    return {
      data: {
        chain: {
          id: chain.id,
          name: chain.name,
          taskIds: chain.taskIds,
          status: chain.status,
          currentTaskIndex: chain.currentTaskIndex,
          autoStart: chain.autoStart,
          createdAt: chain.createdAt,
        },
      },
    };
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const { chain } = content as Output;
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Task chain "${chain.name}" created with ${chain.taskIds.length} tasks. Chain ID: ${chain.id}`,
    };
  },
} satisfies ToolDef<InputSchema, Output>);

export const TaskChainAdvanceTool = buildTool({
  name: 'TaskChainAdvance',
  searchHint: 'advance task chain',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Advance a task chain to the next task';
  },
  async prompt() {
    return 'Advances a task chain to the next task in the sequence. Use this after completing a task in the chain.';
  },
  get inputSchema() {
    return lazySchema(() =>
      z.strictObject({
        chainId: z.string().describe('The ID of the task chain to advance'),
      }),
    )();
  },
  get outputSchema() {
    return lazySchema(() =>
      z.object({
        success: z.boolean(),
        chain: z
          .object({
            id: z.string(),
            status: z.string(),
            currentTaskIndex: z.number(),
            currentTaskId: z.string().nullable(),
          })
          .nullable(),
        error: z.string().optional(),
      }),
    )();
  },
  userFacingName() {
    return 'TaskChainAdvance';
  },
  shouldDefer: true,
  isEnabled() {
    return true;
  },
  isConcurrencySafe() {
    return true;
  },
  renderToolUseMessage() {
    return null;
  },
  async call({ chainId }) {
    const chain = taskChains.get(chainId);
    if (!chain) {
      return {
        data: {
          success: false,
          chain: null,
          error: `Chain #${chainId} not found`,
        },
      };
    }

    updateTaskChainStatus(chain);

    if (chain.status === 'completed') {
      return {
        data: {
          success: true,
          chain: {
            id: chain.id,
            status: chain.status,
            currentTaskIndex: chain.currentTaskIndex,
            currentTaskId: null,
          },
        },
      };
    }

    const currentTaskId = chain.taskIds[chain.currentTaskIndex] ?? null;

    return {
      data: {
        success: true,
        chain: {
          id: chain.id,
          status: chain.status,
          currentTaskIndex: chain.currentTaskIndex,
          currentTaskId,
        },
      },
    };
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const { success, chain, error } = content as {
      success: boolean;
      chain: { id: string; status: string; currentTaskIndex: number; currentTaskId: string | null } | null;
      error?: string;
    };
    if (!success) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: `Error: ${error}`,
      };
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: chain != null && chain.currentTaskId
        ? `Chain #${chain.id} advanced to task #${chain.currentTaskId} (index ${chain.currentTaskIndex})`
        : `Chain #${chain?.id ?? '?'} completed`,
    };
  },
} satisfies ToolDef<z.ZodObject<{ chainId: z.ZodString }>, z.ZodObject<{ success: z.ZodBoolean; chain: z.ZodNullable<z.ZodObject<{ id: z.ZodString; status: z.ZodString; currentTaskIndex: z.ZodNumber; currentTaskId: z.ZodNullable<z.ZodString> }>>; error: z.ZodOptional<z.ZodString> }>>);

export { taskChains };
export type { TaskChain };

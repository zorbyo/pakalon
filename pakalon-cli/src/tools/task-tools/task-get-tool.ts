import { z } from 'zod';
import { buildTool, type ToolDef } from '../tool-types.js';
import { lazySchema } from '../../utils/lazySchema.js';

const inputSchema = lazySchema(() =>
  z.strictObject({
    taskId: z.string().describe('The ID of the task to retrieve'),
  }),
);

type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
  z.object({
    task: z
      .object({
        id: z.string(),
        subject: z.string(),
        description: z.string(),
        status: z.string(),
        priority: z.string().optional(),
        owner: z.string().optional(),
        blocks: z.array(z.string()),
        blockedBy: z.array(z.string()),
        metadata: z.record(z.string(), z.unknown()).optional(),
        createdAt: z.number(),
        updatedAt: z.number(),
        startedAt: z.number().optional(),
        endedAt: z.number().optional(),
        result: z.string().optional(),
        error: z.string().optional(),
      })
      .nullable(),
  }),
);

type OutputSchema = ReturnType<typeof outputSchema>;

export type Output = z.infer<OutputSchema>;

export const TaskGetTool = buildTool({
  name: 'TaskGet',
  searchHint: 'retrieve a task by ID',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Get details of a specific task by ID';
  },
  async prompt() {
    return 'Retrieves detailed information about a specific task including its status, description, dependencies (blockedBy and blocks), owner, and metadata. Returns null if the task is not found.';
  },
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  get outputSchema(): OutputSchema {
    return outputSchema();
  },
  userFacingName() {
    return 'TaskGet';
  },
  shouldDefer: true,
  isEnabled() {
    return true;
  },
  isConcurrencySafe() {
    return true;
  },
  isReadOnly() {
    return true;
  },
  toAutoClassifierInput(input) {
    return input.taskId;
  },
  renderToolUseMessage() {
    return null;
  },
  async call({ taskId }) {
    let task = null;

    try {
      const state = globalThis.__appState;
      if (state?.tasks?.[taskId]) {
        const t = state.tasks[taskId];
        task = {
          id: t.id,
          subject: t.subject,
          description: t.description,
          status: t.status,
          priority: t.priority,
          owner: t.owner,
          blocks: t.blocks || [],
          blockedBy: t.blockedBy || [],
          metadata: t.metadata,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          startedAt: t.startedAt,
          endedAt: t.endedAt,
          result: t.result,
          error: t.error,
        };
      }
    } catch {
      // State not available
    }

    return {
      data: {
        task,
      },
    };
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const { task } = content as Output;
    if (!task) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: 'Task not found',
      };
    }

    const lines = [
      `Task #${task.id}: ${task.subject}`,
      `Status: ${task.status}`,
      `Description: ${task.description}`,
    ];

    if (task.owner) {
      lines.push(`Owner: ${task.owner}`);
    }

    if (task.priority) {
      lines.push(`Priority: ${task.priority}`);
    }

    if (task.blockedBy.length > 0) {
      lines.push(`Blocked by: ${task.blockedBy.map((id) => `#${id}`).join(', ')}`);
    }

    if (task.blocks.length > 0) {
      lines.push(`Blocks: ${task.blocks.map((id) => `#${id}`).join(', ')}`);
    }

    if (task.result) {
      lines.push(`Result: ${task.result}`);
    }

    if (task.error) {
      lines.push(`Error: ${task.error}`);
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: lines.join('\n'),
    };
  },
} satisfies ToolDef<InputSchema, Output>);

export default TaskGetTool;
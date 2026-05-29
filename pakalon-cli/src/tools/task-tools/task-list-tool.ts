import { z } from 'zod';
import { buildTool, type ToolDef } from '../tool-types.js';
import { lazySchema } from '../../utils/lazySchema.js';

const inputSchema = lazySchema(() =>
  z.strictObject({
    status: z
      .enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled'])
      .optional()
      .describe('Filter by task status'),
    limit: z.number().optional().default(50).describe('Maximum number of tasks to return'),
  }),
);

type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
  z.object({
    tasks: z.array(
      z.object({
        id: z.string(),
        subject: z.string(),
        description: z.string(),
        status: z.string(),
        priority: z.string().optional(),
        owner: z.string().optional(),
        blockedBy: z.array(z.string()),
      }),
    ),
    count: z.number(),
  }),
);

type OutputSchema = ReturnType<typeof outputSchema>;

export type Output = z.infer<OutputSchema>;

export const TaskListTool = buildTool({
  name: 'TaskList',
  searchHint: 'list all tasks',
  maxResultSizeChars: 100_000,
  async description() {
    return 'List all tasks in the task list';
  },
  async prompt() {
    return 'Lists all tasks in the task list. Can be filtered by status. Each task shows its ID, subject, status, and blockedBy dependencies. Use TaskCreate to add new tasks, TaskGet to see details, TaskUpdate to modify tasks, and TaskStop to stop running tasks.';
  },
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  get outputSchema(): OutputSchema {
    return outputSchema();
  },
  userFacingName() {
    return 'TaskList';
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
  renderToolUseMessage() {
    return null;
  },
  async call({ status, limit }) {
    const tasks: Array<{
      id: string;
      subject: string;
      description: string;
      status: string;
      priority?: string;
      owner?: string;
      blockedBy: string[];
    }> = [];

    let taskList: Record<string, unknown> = {};
    try {
      const state = globalThis.__appState;
      if (state?.tasks) {
        taskList = state.tasks;
      }
    } catch {
      // State not available
    }

    const allTasks = Object.values(taskList) as Array<{
      id: string;
      subject: string;
      description: string;
      status: string;
      priority?: string;
      owner?: string;
      blockedBy: string[];
    }>;

    let filteredTasks = allTasks;

    if (status) {
      filteredTasks = filteredTasks.filter((t) => t.status === status);
    }

    const resolvedTaskIds = new Set(
      filteredTasks.filter((t) => t.status === 'completed').map((t) => t.id),
    );

    filteredTasks = filteredTasks
      .filter((t) => !t.metadata?._internal)
      .map((task) => ({
        ...task,
        blockedBy: (task.blockedBy || []).filter((id: string) => !resolvedTaskIds.has(id)),
      }))
      .sort((a, b) => (b.id > a.id ? 1 : -1))
      .slice(0, limit || 50);

    return {
      data: {
        tasks: filteredTasks,
        count: filteredTasks.length,
      },
    };
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const { tasks, count } = content as Output;
    if (tasks.length === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: 'No tasks found',
      };
    }

    const lines = tasks.map((task) => {
      const owner = task.owner ? ` (${task.owner})` : '';
      const blocked =
        task.blockedBy.length > 0
          ? ` [blocked by ${task.blockedBy.map((id) => `#${id}`).join(', ')}]`
          : '';
      return `#${task.id} [${task.status}] ${task.subject}${owner}${blocked}`;
    });

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `${lines.join('\n')}\n\nTotal: ${count} task(s)`,
    };
  },
} satisfies ToolDef<InputSchema, Output>);

export default TaskListTool;
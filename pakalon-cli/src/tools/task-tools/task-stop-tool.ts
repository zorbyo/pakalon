import { z } from 'zod';
import { buildTool, type ToolDef } from '../tool-types.js';
import { lazySchema } from '../../utils/lazySchema.js';

const inputSchema = lazySchema(() =>
  z.strictObject({
    task_id: z.string().optional().describe('The ID of the background task to stop'),
    shell_id: z.string().optional().describe('Deprecated: use task_id instead'),
  }),
);

type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
  z.object({
    message: z.string().describe('Status message about the operation'),
    task_id: z.string().describe('The ID of the task that was stopped'),
    task_type: z.string().describe('The type of the task that was stopped'),
    command: z.string().optional().describe('The command or description of the stopped task'),
  }),
);

type OutputSchema = ReturnType<typeof outputSchema>;

export type Output = z.infer<OutputSchema>;

function stopTask(
  taskId: string,
  setAppState: (f: (prev: Record<string, unknown>) => Record<string, unknown>) => void,
): { taskId: string; taskType: string; command: string } {
  let result = { taskId, taskType: 'task', command: '' };

  setAppState((prev) => {
    const tasks = prev.tasks || {};
    const task = tasks[taskId] as { type?: string; description?: string } | undefined;

    if (task) {
      result = {
        taskId,
        taskType: task.type || 'task',
        command: task.description || '',
      };
    }

    return {
      ...prev,
      tasks: {
        ...tasks,
        [taskId]: {
          ...task,
          status: 'cancelled',
          endedAt: Date.now(),
        },
      },
    };
  });

  return result;
}

export const TaskStopTool = buildTool({
  name: 'TaskStop',
  searchHint: 'kill a running background task',
  aliases: ['KillShell'],
  maxResultSizeChars: 100_000,
  userFacingName: () => 'Stop Task',
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  get outputSchema(): OutputSchema {
    return outputSchema();
  },
  shouldDefer: true,
  isConcurrencySafe() {
    return true;
  },
  toAutoClassifierInput(input) {
    return input.task_id ?? input.shell_id ?? '';
  },
  async validateInput({ task_id, shell_id }, { getAppState }) {
    const id = task_id ?? shell_id;
    if (!id) {
      return {
        result: false,
        message: 'Missing required parameter: task_id',
        errorCode: 1,
      };
    }

    const appState = getAppState();
    const task = (appState.tasks?.[id] as { status?: string } | undefined);

    if (!task) {
      return {
        result: false,
        message: `No task found with ID: ${id}`,
        errorCode: 1,
      };
    }

    if (task.status !== 'running' && task.status !== 'pending' && task.status !== 'in_progress') {
      return {
        result: false,
        message: `Task ${id} is not running (status: ${task.status})`,
        errorCode: 3,
      };
    }

    return { result: true };
  },
  async description() {
    return 'Stop a running background task by ID';
  },
  async prompt() {
    return 'Stops or kills a running background task. Takes a task_id to identify which task to stop. Returns the task ID, type, and command of the stopped task. Only tasks with status "running", "pending", or "in_progress" can be stopped.';
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: JSON.stringify(output),
    };
  },
  renderToolUseMessage() {
    return null;
  },
  renderToolResultMessage() {
    return null;
  },
  async call({ task_id, shell_id }, { getAppState, setAppState }) {
    const id = task_id ?? shell_id;
    if (!id) {
      throw new Error('Missing required parameter: task_id');
    }

    const appState = getAppState();
    const task = appState.tasks?.[id] as { type?: string; description?: string; status?: string } | undefined;

    if (!task) {
      throw new Error(`No task found with ID: ${id}`);
    }

    if (task.status !== 'running' && task.status !== 'pending' && task.status !== 'in_progress') {
      throw new Error(`Task ${id} is not running (status: ${task.status})`);
    }

    const result = stopTask(id, setAppState);

    return {
      data: {
        message: `Successfully stopped task: ${result.taskId} (${result.command})`,
        task_id: result.taskId,
        task_type: result.taskType,
        command: result.command,
      },
    };
  },
} satisfies ToolDef<InputSchema, Output>);

export default TaskStopTool;
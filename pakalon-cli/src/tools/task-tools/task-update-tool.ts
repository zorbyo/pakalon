import { z } from 'zod';
import { buildTool, type ToolDef } from '../tool-types.js';
import { lazySchema } from '../../utils/lazySchema.js';

const inputSchema = lazySchema(() => {
  const TaskUpdateStatusSchema = z.enum([
    'pending',
    'in_progress',
    'completed',
    'failed',
    'cancelled',
    'deleted',
  ]);

  return z.strictObject({
    taskId: z.string().describe('The ID of the task to update'),
    subject: z.string().optional().describe('New subject for the task'),
    description: z.string().optional().describe('New description for the task'),
    activeForm: z
      .string()
      .optional()
      .describe(
        'Present continuous form shown in spinner when in_progress (e.g., "Running tests")',
      ),
    status: TaskUpdateStatusSchema.optional().describe('New status for the task'),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().describe('New priority for the task'),
    owner: z.string().optional().describe('New owner for the task'),
    addBlocks: z
      .array(z.string())
      .optional()
      .describe('Task IDs that this task blocks'),
    addBlockedBy: z
      .array(z.string())
      .optional()
      .describe('Task IDs that block this task'),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Metadata keys to merge into the task. Set a key to null to delete it.'),
  });
});

type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    taskId: z.string(),
    updatedFields: z.array(z.string()),
    error: z.string().optional(),
    statusChange: z
      .object({
        from: z.string(),
        to: z.string(),
      })
      .optional(),
  }),
);

type OutputSchema = ReturnType<typeof outputSchema>;

export type Output = z.infer<OutputSchema>;

export const TaskUpdateTool = buildTool({
  name: 'TaskUpdate',
  searchHint: 'update a task',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Update a task by modifying its fields';
  },
  async prompt() {
    return 'Updates an existing task with new values for any of its fields: subject, description, activeForm, status, priority, owner, metadata, addBlocks, addBlockedBy. When status is set to "deleted", the task is removed. Returns the list of fields that were actually updated.';
  },
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  get outputSchema(): OutputSchema {
    return outputSchema();
  },
  userFacingName() {
    return 'TaskUpdate';
  },
  shouldDefer: true,
  isEnabled() {
    return true;
  },
  isConcurrencySafe() {
    return true;
  },
  toAutoClassifierInput(input) {
    const parts = [input.taskId];
    if (input.status) parts.push(input.status);
    if (input.subject) parts.push(input.subject);
    return parts.join(' ');
  },
  renderToolUseMessage() {
    return null;
  },
  async call(
    {
      taskId,
      subject,
      description,
      activeForm,
      status,
      priority,
      owner,
      addBlocks,
      addBlockedBy,
      metadata,
    },
    context,
  ) {
    let existingTask: {
      subject: string;
      description: string;
      status: string;
      priority?: string;
      owner?: string;
      blocks: string[];
      blockedBy: string[];
      activeForm?: string;
      metadata?: Record<string, unknown>;
    } | null = null;

    try {
      const appState = context.getAppState();
      const task = appState.tasks?.[taskId];
      if (task) {
        existingTask = {
          subject: task.subject,
          description: task.description,
          status: task.status,
          priority: task.priority,
          owner: task.owner,
          blocks: task.blocks || [],
          blockedBy: task.blockedBy || [],
          activeForm: task.activeForm,
          metadata: task.metadata,
        };
      }
    } catch {
      // State not available
    }

    if (!existingTask) {
      return {
        data: {
          success: false,
          taskId,
          updatedFields: [],
          error: 'Task not found',
        },
      };
    }

    const updatedFields: string[] = [];

    if (status === 'deleted') {
      context.setAppState((prev) => {
        const tasks = { ...(prev.tasks || {}) };
        delete tasks[taskId];
        return { ...prev, tasks };
      });

      return {
        data: {
          success: true,
          taskId,
          updatedFields: ['deleted'],
          statusChange: { from: existingTask.status, to: 'deleted' },
        },
      };
    }

    const updates: Record<string, unknown> = {};

    if (subject !== undefined && subject !== existingTask.subject) {
      updates.subject = subject;
      updatedFields.push('subject');
    }

    if (description !== undefined && description !== existingTask.description) {
      updates.description = description;
      updatedFields.push('description');
    }

    if (activeForm !== undefined && activeForm !== existingTask.activeForm) {
      updates.activeForm = activeForm;
      updatedFields.push('activeForm');
    }

    if (priority !== undefined && priority !== existingTask.priority) {
      updates.priority = priority;
      updatedFields.push('priority');
    }

    if (owner !== undefined && owner !== existingTask.owner) {
      updates.owner = owner;
      updatedFields.push('owner');
    }

    if (metadata !== undefined) {
      const merged = { ...(existingTask.metadata ?? {}) };
      for (const [key, value] of Object.entries(metadata)) {
        if (value === null) {
          delete merged[key];
        } else {
          merged[key] = value;
        }
      }
      updates.metadata = merged;
      updatedFields.push('metadata');
    }

    let statusChange: { from: string; to: string } | undefined;
    if (status !== undefined && status !== existingTask.status) {
      statusChange = { from: existingTask.status, to: status };
      updates.status = status;
      updatedFields.push('status');

      if (status === 'in_progress' && !existingTask.startedAt) {
        updates.startedAt = Date.now();
        updatedFields.push('startedAt');
      }

      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        updates.endedAt = Date.now();
        updatedFields.push('endedAt');
      }
    }

    if (addBlocks && addBlocks.length > 0) {
      const newBlocks = addBlocks.filter((id) => !existingTask.blocks.includes(id));
      if (newBlocks.length > 0) {
        updates.blocks = [...existingTask.blocks, ...newBlocks];
        updatedFields.push('blocks');
      }
    }

    if (addBlockedBy && addBlockedBy.length > 0) {
      const newBlockedBy = addBlockedBy.filter((id) => !existingTask.blockedBy.includes(id));
      if (newBlockedBy.length > 0) {
        updates.blockedBy = [...existingTask.blockedBy, ...newBlockedBy];
        updatedFields.push('blockedBy');
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = Date.now();
      context.setAppState((prev) => {
        const tasks = prev.tasks || {};
        return {
          ...prev,
          tasks: {
            ...tasks,
            [taskId]: {
              ...tasks[taskId],
              ...updates,
            },
          },
        };
      });
    }

    return {
      data: {
        success: true,
        taskId,
        updatedFields,
        statusChange,
      },
    };
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const { success, taskId, updatedFields, error, statusChange } = content as Output;

    if (!success) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: error || `Task #${taskId} not found`,
      };
    }

    let resultContent = `Updated task #${taskId}: ${updatedFields.join(', ')}`;

    if (statusChange) {
      resultContent += `\nStatus changed from ${statusChange.from} to ${statusChange.to}`;
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: resultContent,
    };
  },
} satisfies ToolDef<InputSchema, Output>);

export default TaskUpdateTool;
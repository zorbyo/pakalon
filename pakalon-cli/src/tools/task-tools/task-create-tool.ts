import { z } from 'zod';
import { buildTool, type ToolDef } from '../tool-types.js';
import { lazySchema } from '../../utils/lazySchema.js';
import { registerAgent, startAgent } from '@/services/agent-summary.js';

const inputSchema = lazySchema(() =>
  z.strictObject({
    subject: z.string().describe('A brief title for the task'),
    description: z.string().describe('What needs to be done'),
    activeForm: z
      .string()
      .optional()
      .describe(
        'Present continuous form shown in spinner when in_progress (e.g., "Running tests")',
      ),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Arbitrary metadata to attach to the task'),
  }),
);

type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
  z.object({
    task: z.object({
      id: z.string(),
      subject: z.string(),
      description: z.string(),
      status: z.string(),
    }),
  }),
);

type OutputSchema = ReturnType<typeof outputSchema>;

export type Output = z.infer<OutputSchema>;

let taskIdCounter = 0;

function generateTaskId(): string {
  return `task_${Date.now()}_${++taskIdCounter}`;
}

export const TaskCreateTool = buildTool({
  name: 'TaskCreate',
  searchHint: 'create a task in the task list',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Create a new task in the task list';
  },
  async prompt() {
    return 'Creates a new task with a subject, description, and optional metadata. Tasks can be tracked and managed using the TaskList, TaskGet, TaskUpdate, and TaskStop tools.';
  },
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  get outputSchema(): OutputSchema {
    return outputSchema();
  },
  userFacingName() {
    return 'TaskCreate';
  },
  shouldDefer: true,
  isEnabled() {
    return true;
  },
  isConcurrencySafe() {
    return true;
  },
  toAutoClassifierInput(input) {
    return input.subject;
  },
  renderToolUseMessage() {
    return null;
  },
  async call({ subject, description, activeForm, metadata }, context) {
    const taskId = generateTaskId();
    const now = Date.now();

    // Register with agent summarization system
    const agentProgress = registerAgent(taskId, subject);
    startAgent(taskId, activeForm || "Processing...");

    const newTask = {
      id: taskId,
      subject,
      description,
      status: 'pending' as const,
      priority: 'medium' as const,
      tags: [] as string[],
      blocks: [] as string[],
      blockedBy: [] as string[],
      activeForm,
      metadata,
      createdAt: now,
      updatedAt: now,
    };

    context.setAppState((prev) => {
      const tasks = prev.tasks || {};
      return {
        ...prev,
        tasks: {
          ...tasks,
          [taskId]: newTask,
        },
      };
    });

    return {
      data: {
        task: {
          id: taskId,
          subject,
          description,
          status: 'pending',
        },
      },
    };
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const { task } = content as Output;
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Task #${task.id} created successfully: ${task.subject}`,
    };
  },
} satisfies ToolDef<InputSchema, Output>);

export default TaskCreateTool;
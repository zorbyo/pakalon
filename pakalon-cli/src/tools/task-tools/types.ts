import { z } from 'zod';

export const TaskStatusSchema = () =>
  z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled']);

export type TaskStatus = z.infer<ReturnType<typeof TaskStatusSchema>>;

export const TaskPrioritySchema = () =>
  z.enum(['low', 'medium', 'high', 'urgent']);

export type TaskPriority = z.infer<ReturnType<typeof TaskPrioritySchema>>;

export interface TaskStateBase {
  id: string;
  subject: string;
  description: string;
  status: TaskStatus;
  priority?: TaskPriority;
  tags?: string[];
  owner?: string;
  blocks: string[];
  blockedBy: string[];
  activeForm?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  endedAt?: number;
  result?: string;
  error?: string;
  notified?: boolean;
}

export interface TaskState extends TaskStateBase {
  type: TaskType;
}

export type TaskType = 'local_bash' | 'local_agent' | 'remote_agent' | 'task';

export interface LocalShellTaskState extends TaskStateBase {
  type: 'local_bash';
  shellCommand?: {
    command: string;
    taskOutput?: {
      getStdout: () => Promise<string>;
      getStderr: () => string;
    };
  };
  result?: {
    code: number | null;
  };
}

export interface LocalAgentTaskState extends TaskStateBase {
  type: 'local_agent';
  prompt: string;
  result?: {
    content: Array<{ type: 'text'; text: string }>;
  };
  error?: string;
}

export interface RemoteAgentTaskState extends TaskStateBase {
  type: 'remote_agent';
  command: string;
}

export interface TaskListState {
  tasks: Record<string, TaskState>;
}

export interface TaskOutput {
  task_id: string;
  task_type: TaskType;
  status: string;
  description: string;
  output: string;
  exitCode?: number | null;
  error?: string;
  prompt?: string;
  result?: string;
}

export const TASK_CREATE_TOOL_NAME = 'TaskCreate';
export const TASK_LIST_TOOL_NAME = 'TaskList';
export const TASK_GET_TOOL_NAME = 'TaskGet';
export const TASK_STOP_TOOL_NAME = 'TaskStop';
export const TASK_UPDATE_TOOL_NAME = 'TaskUpdate';
export const TASK_OUTPUT_TOOL_NAME = 'TaskOutput';
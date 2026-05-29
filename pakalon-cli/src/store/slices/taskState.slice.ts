import type { StateCreator } from "zustand";

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled";

export interface TaskRecord {
  id: string;
  status: TaskStatus;
  agentId: string;
  createdAt: number;
  completedAt: number | null;
  result?: string;
  error?: string;
}

export type TaskState = TaskRecord;

export interface TaskStateSlice {
  tasks: Record<string, TaskRecord>;
  activeTaskIds: string[];
  maxTasks: number;
  createTask: (taskId: string, agentId: string, createdAt?: number) => string;
  updateTaskStatus: (taskId: string, status: TaskStatus) => void;
  completeTask: (taskId: string, result?: string) => void;
  failTask: (taskId: string, error: string) => void;
  removeTask: (taskId: string) => void;
}

function normalizeActiveTaskIds(tasks: Record<string, TaskRecord>): string[] {
  return Object.values(tasks)
    .filter((task) => task.status === "pending" || task.status === "in_progress")
    .map((task) => task.id);
}

export const createTaskStateSlice: StateCreator<TaskStateSlice> = (set, get) => ({
  tasks: {},
  activeTaskIds: [],
  maxTasks: 100,

  createTask: (taskId, agentId, createdAt = Date.now()) => {
    set((state) => {
      const tasks = {
        ...state.tasks,
        [taskId]: {
          id: taskId,
          status: "pending" as const,
          agentId,
          createdAt,
          completedAt: null,
        },
      };
      const ordered = Object.values(tasks).sort((a, b) => a.createdAt - b.createdAt);
      while (ordered.length > state.maxTasks) {
        const oldest = ordered.shift();
        if (oldest) delete tasks[oldest.id];
      }
      return {
        tasks,
        activeTaskIds: normalizeActiveTaskIds(tasks),
      };
    });
    return taskId;
  },

  updateTaskStatus: (taskId, status) =>
    set((state) => {
      const task = state.tasks[taskId];
      if (!task) return state;
      const completedAt = status === "completed" || status === "failed" || status === "cancelled" ? Date.now() : task.completedAt;
      const tasks = {
        ...state.tasks,
        [taskId]: { ...task, status, completedAt },
      };
      return {
        tasks,
        activeTaskIds: normalizeActiveTaskIds(tasks),
      };
    }),

  completeTask: (taskId, result) =>
    set((state) => {
      const task = state.tasks[taskId];
      if (!task) return state;
      const tasks = {
        ...state.tasks,
        [taskId]: {
          ...task,
          status: "completed" as const,
          completedAt: Date.now(),
          result,
          error: undefined,
        },
      };
      return {
        tasks,
        activeTaskIds: normalizeActiveTaskIds(tasks),
      };
    }),

  failTask: (taskId, error) =>
    set((state) => {
      const task = state.tasks[taskId];
      if (!task) return state;
      const tasks = {
        ...state.tasks,
        [taskId]: {
          ...task,
          status: "failed" as const,
          completedAt: Date.now(),
          error,
        },
      };
      return {
        tasks,
        activeTaskIds: normalizeActiveTaskIds(tasks),
      };
    }),

  removeTask: (taskId) =>
    set((state) => {
      if (!state.tasks[taskId]) return state;
      const tasks = { ...state.tasks };
      delete tasks[taskId];
      return {
        tasks,
        activeTaskIds: state.activeTaskIds.filter((id) => id !== taskId),
      };
    }),
});

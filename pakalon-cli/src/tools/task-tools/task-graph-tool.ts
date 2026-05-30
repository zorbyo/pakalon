import { z } from 'zod';
import { buildTool, type ToolDef } from '../tool-types.js';
import { lazySchema } from '../../utils/lazySchema.js';

const inputSchema = lazySchema(() =>
  z.strictObject({
    format: z
      .enum(['ascii', 'mermaid', 'json'])
      .optional()
      .default('ascii')
      .describe('Output format for the dependency graph'),
    includeCompleted: z
      .boolean()
      .optional()
      .default(false)
      .describe('Include completed tasks in the graph'),
  }),
);

type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
  z.object({
    graph: z.string(),
    stats: z.object({
      totalTasks: z.number(),
      pendingTasks: z.number(),
      inProgressTasks: z.number(),
      completedTasks: z.number(),
      hasCircularDeps: z.boolean(),
      criticalPathLength: z.number(),
    }),
    circularDeps: z.array(z.array(z.string())).optional(),
    criticalPath: z.array(z.string()).optional(),
  }),
);

type OutputSchema = ReturnType<typeof outputSchema>;

export type Output = z.infer<OutputSchema>;

interface TaskNode {
  id: string;
  subject: string;
  status: string;
  blockedBy: string[];
  blocks: string[];
}

function getAllTasks(): Record<string, TaskNode> {
  const tasks: Record<string, TaskNode> = {};
  try {
    const state = (globalThis as Record<string, unknown>).__appState as Record<string, unknown> | undefined;
    if (state?.tasks) {
      for (const [id, t] of Object.entries(state.tasks as Record<string, Record<string, unknown>>)) {
        tasks[id] = {
          id: id,
          subject: String(t.subject ?? ''),
          status: String(t.status ?? 'pending'),
          blockedBy: Array.isArray(t.blockedBy) ? (t.blockedBy as string[]) : [],
          blocks: Array.isArray(t.blocks) ? (t.blocks as string[]) : [],
        };
      }
    }
  } catch {
    // State not available
  }
  return tasks;
}

function detectCircularDependencies(tasks: Record<string, TaskNode>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(node: string, path: string[]): void {
    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const task = tasks[node];
    if (task) {
      for (const dep of task.blockedBy) {
        if (!visited.has(dep)) {
          dfs(dep, [...path]);
        } else if (recursionStack.has(dep)) {
          const cycleStart = path.indexOf(dep);
          if (cycleStart !== -1) {
            cycles.push(path.slice(cycleStart).concat(dep));
          }
        }
      }
    }

    recursionStack.delete(node);
  }

  for (const id of Object.keys(tasks)) {
    if (!visited.has(id)) {
      dfs(id, []);
    }
  }

  return cycles;
}

function getCriticalPath(tasks: Record<string, TaskNode>): string[] {
  const completed = new Set(
    Object.values(tasks)
      .filter((t) => t.status === 'completed')
      .map((t) => t.id),
  );

  const getLongestPath = (nodeId: string, memo: Map<string, string[]>): string[] => {
    if (memo.has(nodeId)) return memo.get(nodeId)!;

    const task = tasks[nodeId];
    if (!task) {
      memo.set(nodeId, []);
      return [];
    }

    let longestPath: string[] = [];
    for (const dep of task.blockedBy) {
      if (!completed.has(dep)) {
        const path = getLongestPath(dep, memo);
        if (path.length > longestPath.length) {
          longestPath = path;
        }
      }
    }

    const result = [...longestPath, nodeId];
    memo.set(nodeId, result);
    return result;
  };

  const memo = new Map<string, string[]>();
  let criticalPath: string[] = [];

  for (const id of Object.keys(tasks)) {
    if (!completed.has(id)) {
      const path = getLongestPath(id, memo);
      if (path.length > criticalPath.length) {
        criticalPath = path;
      }
    }
  }

  return criticalPath;
}

function renderAsciiGraph(tasks: Record<string, TaskNode>): string {
  const lines: string[] = ['Task Dependency Graph', '====================', ''];

  const statusIcons: Record<string, string> = {
    pending: '[ ]',
    in_progress: '[>]',
    completed: '[x]',
    failed: '[!]',
    cancelled: '[-]',
  };

  for (const task of Object.values(tasks)) {
    const icon = statusIcons[task.status] || '[?]';
    lines.push(`${icon} #${task.id}: ${task.subject}`);

    if (task.blockedBy.length > 0) {
      lines.push(`    Blocked by: ${task.blockedBy.map((id) => `#${id}`).join(', ')}`);
    }
    if (task.blocks.length > 0) {
      lines.push(`    Blocks: ${task.blocks.map((id) => `#${id}`).join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function renderMermaidGraph(tasks: Record<string, TaskNode>): string {
  const lines: string[] = ['graph TD'];

  for (const task of Object.values(tasks)) {
    const label = task.subject.replace(/"/g, "'").substring(0, 30);
    lines.push(`    ${task.id}["${task.id}: ${label}"]`);

    for (const dep of task.blockedBy) {
      lines.push(`    ${dep} --> ${task.id}`);
    }
  }

  return lines.join('\n');
}

export const TaskGraphTool = buildTool({
  name: 'TaskGraph',
  searchHint: 'show task dependency graph',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Display task dependency graph with cycle detection and critical path';
  },
  async prompt() {
    return 'Shows a visualization of all tasks and their dependencies. Detects circular dependencies and identifies the critical path. Supports ASCII, Mermaid, and JSON output formats.';
  },
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  get outputSchema(): OutputSchema {
    return outputSchema();
  },
  userFacingName() {
    return 'TaskGraph';
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
  async call({ format, includeCompleted }) {
    const allTasks = getAllTasks();

    const tasks = includeCompleted
      ? allTasks
      : Object.fromEntries(
          Object.entries(allTasks).filter(
            ([, t]) => t.status !== 'completed' && t.status !== 'cancelled',
          ),
        );

    const circularDeps = detectCircularDependencies(tasks);
    const criticalPath = getCriticalPath(tasks);

    let graph: string;
    if (format === 'mermaid') {
      graph = renderMermaidGraph(tasks);
    } else if (format === 'json') {
      graph = JSON.stringify({ tasks, circularDeps, criticalPath }, null, 2);
    } else {
      graph = renderAsciiGraph(tasks);
    }

    const stats = {
      totalTasks: Object.keys(tasks).length,
      pendingTasks: Object.values(tasks).filter((t) => t.status === 'pending').length,
      inProgressTasks: Object.values(tasks).filter((t) => t.status === 'in_progress').length,
      completedTasks: Object.values(tasks).filter((t) => t.status === 'completed').length,
      hasCircularDeps: circularDeps.length > 0,
      criticalPathLength: criticalPath.length,
    };

    return {
      data: {
        graph,
        stats,
        circularDeps: circularDeps.length > 0 ? circularDeps : undefined,
        criticalPath: criticalPath.length > 0 ? criticalPath : undefined,
      },
    };
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const { stats } = content as Output;
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Task graph: ${stats.totalTasks} tasks, ${stats.pendingTasks} pending, ${stats.inProgressTasks} in progress. ${stats.hasCircularDeps ? 'WARNING: Circular dependencies detected!' : 'No circular dependencies.'}`,
    };
  },
} satisfies ToolDef<InputSchema, Output>);

export default TaskGraphTool;

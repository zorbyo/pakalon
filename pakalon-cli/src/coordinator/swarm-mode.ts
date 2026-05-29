/**
 * Enhanced Coordinator/Swarm Mode — Multi-agent orchestration patterns.
 *
 * Provides comprehensive multi-agent coordination:
 * - Swarm mode for parallel task execution
 * - Team system with role-based agents
 * - Task distribution and load balancing
 * - Inter-agent communication
 * - Result aggregation
 *
 * Port from Claude Code's coordinator patterns.
 */

import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type SwarmMode = "coordinator" | "swarm" | "hierarchical" | "pipeline";

export type AgentRole =
  | "researcher"
  | "implementer"
  | "reviewer"
  | "tester"
  | "documenter"
  | "custom";

export type TaskStatus = "pending" | "assigned" | "running" | "completed" | "failed" | "cancelled";

export type TaskPriority = "low" | "normal" | "high" | "critical";

export interface SwarmAgent {
  /** Agent ID */
  id: string;
  /** Agent name */
  name: string;
  /** Agent role */
  role: AgentRole;
  /** Agent capabilities */
  capabilities: string[];
  /** Current status */
  status: "idle" | "busy" | "offline";
  /** Current task ID */
  currentTaskId?: string;
  /** Tasks completed */
  completedTasks: number;
  /** Tasks failed */
  failedTasks: number;
  /** Average task duration (ms) */
  avgDurationMs: number;
  /** Last active timestamp */
  lastActiveAt: Date;
}

export interface SwarmTask {
  /** Task ID */
  id: string;
  /** Task description */
  description: string;
  /** Task type */
  type: string;
  /** Task priority */
  priority: TaskPriority;
  /** Task status */
  status: TaskStatus;
  /** Assigned agent ID */
  assignedAgentId?: string;
  /** Required capabilities */
  requiredCapabilities: string[];
  /** Task input data */
  input: Record<string, unknown>;
  /** Task output data */
  output?: Record<string, unknown>;
  /** Error message if failed */
  error?: string;
  /** Created timestamp */
  createdAt: Date;
  /** Started timestamp */
  startedAt?: Date;
  /** Completed timestamp */
  completedAt?: Date;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Dependencies (task IDs) */
  dependencies: string[];
}

export interface SwarmTeam {
  /** Team ID */
  id: string;
  /** Team name */
  name: string;
  /** Team description */
  description: string;
  /** Team members (agent IDs) */
  memberIds: string[];
  /** Team coordinator agent ID */
  coordinatorId: string;
  /** Active tasks */
  activeTaskIds: string[];
  /** Completed tasks */
  completedTaskIds: string[];
  /** Team creation timestamp */
  createdAt: Date;
}

export interface SwarmConfig {
  /** Swarm mode */
  mode: SwarmMode;
  /** Maximum concurrent agents */
  maxConcurrentAgents: number;
  /** Maximum tasks per agent */
  maxTasksPerAgent: number;
  /** Task timeout (ms) */
  taskTimeoutMs: number;
  /** Whether to auto-reassign failed tasks */
  autoReassign: boolean;
  /** Maximum retry attempts */
  maxRetries: number;
}

export interface SwarmStats {
  /** Total agents */
  totalAgents: number;
  /** Idle agents */
  idleAgents: number;
  /** Busy agents */
  busyAgents: number;
  /** Total tasks */
  totalTasks: number;
  /** Pending tasks */
  pendingTasks: number;
  /** Running tasks */
  runningTasks: number;
  /** Completed tasks */
  completedTasks: number;
  /** Failed tasks */
  failedTasks: number;
  /** Average task duration */
  avgTaskDurationMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Swarm Manager
// ─────────────────────────────────────────────────────────────────────────────

export class SwarmManager {
  private agents: Map<string, SwarmAgent> = new Map();
  private tasks: Map<string, SwarmTask> = new Map();
  private teams: Map<string, SwarmTeam> = new Map();
  private config: SwarmConfig;
  private eventListeners: Array<(event: SwarmEvent) => void> = [];

  constructor(config?: Partial<SwarmConfig>) {
    this.config = {
      mode: "coordinator",
      maxConcurrentAgents: 10,
      maxTasksPerAgent: 5,
      taskTimeoutMs: 300000, // 5 minutes
      autoReassign: true,
      maxRetries: 3,
      ...config,
    };
  }

  /**
   * Subscribe to swarm events.
   */
  onEvent(listener: (event: SwarmEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      const index = this.eventListeners.indexOf(listener);
      if (index !== -1) {
        this.eventListeners.splice(index, 1);
      }
    };
  }

  /**
   * Emit a swarm event.
   */
  private emitEvent(event: SwarmEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error("[Swarm] Event listener error", { error: String(error) });
      }
    }
  }

  /**
   * Register a new agent.
   */
  registerAgent(agent: Omit<SwarmAgent, "completedTasks" | "failedTasks" | "avgDurationMs" | "lastActiveAt">): SwarmAgent {
    const fullAgent: SwarmAgent = {
      ...agent,
      completedTasks: 0,
      failedTasks: 0,
      avgDurationMs: 0,
      lastActiveAt: new Date(),
    };

    this.agents.set(fullAgent.id, fullAgent);
    this.emitEvent({ type: "agent_registered", agent: fullAgent });

    logger.debug("[Swarm] Agent registered", {
      id: fullAgent.id,
      name: fullAgent.name,
      role: fullAgent.role,
    });

    return fullAgent;
  }

  /**
   * Create a new task.
   */
  createTask(task: Omit<SwarmTask, "id" | "status" | "createdAt">): SwarmTask {
    const fullTask: SwarmTask = {
      ...task,
      id: crypto.randomUUID(),
      status: "pending",
      createdAt: new Date(),
    };

    this.tasks.set(fullTask.id, fullTask);
    this.emitEvent({ type: "task_created", task: fullTask });

    logger.debug("[Swarm] Task created", {
      id: fullTask.id,
      description: fullTask.description,
      priority: fullTask.priority,
    });

    return fullTask;
  }

  /**
   * Assign a task to an agent.
   */
  assignTask(taskId: string, agentId: string): boolean {
    const task = this.tasks.get(taskId);
    const agent = this.agents.get(agentId);

    if (!task || !agent) return false;
    if (task.status !== "pending") return false;
    if (agent.status !== "idle") return false;

    task.status = "assigned";
    task.assignedAgentId = agentId;
    task.startedAt = new Date();

    agent.status = "busy";
    agent.currentTaskId = taskId;

    this.emitEvent({ type: "task_assigned", task, agent });

    logger.debug("[Swarm] Task assigned", {
      taskId,
      agentId,
    });

    return true;
  }

  /**
   * Auto-assign pending tasks to idle agents.
   */
  autoAssign(): number {
    let assignedCount = 0;

    // Sort tasks by priority
    const pendingTasks = Array.from(this.tasks.values())
      .filter((t) => t.status === "pending")
      .sort((a, b) => {
        const priorityOrder = { critical: 4, high: 3, normal: 2, low: 1 };
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      });

    // Get idle agents
    const idleAgents = Array.from(this.agents.values())
      .filter((a) => a.status === "idle");

    for (const task of pendingTasks) {
      if (assignedCount >= idleAgents.length) break;

      // Find an agent with matching capabilities
      const agent = idleAgents.find(
        (a) =>
          a.status === "idle" &&
          task.requiredCapabilities.every((cap) => a.capabilities.includes(cap))
      );

      if (agent) {
        this.assignTask(task.id, agent.id);
        assignedCount++;
      }
    }

    return assignedCount;
  }

  /**
   * Complete a task.
   */
  completeTask(taskId: string, output: Record<string, unknown>): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    task.status = "completed";
    task.output = output;
    task.completedAt = new Date();
    task.durationMs = task.completedAt.getTime() - (task.startedAt?.getTime() ?? task.createdAt.getTime());

    // Update agent stats
    if (task.assignedAgentId) {
      const agent = this.agents.get(task.assignedAgentId);
      if (agent) {
        agent.status = "idle";
        agent.currentTaskId = undefined;
        agent.completedTasks++;
        agent.avgDurationMs =
          (agent.avgDurationMs * (agent.completedTasks - 1) + (task.durationMs ?? 0)) /
          agent.completedTasks;
        agent.lastActiveAt = new Date();
      }
    }

    this.emitEvent({ type: "task_completed", task });

    logger.debug("[Swarm] Task completed", {
      taskId,
      durationMs: task.durationMs,
    });

    return true;
  }

  /**
   * Fail a task.
   */
  failTask(taskId: string, error: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    task.status = "failed";
    task.error = error;
    task.completedAt = new Date();
    task.durationMs = task.completedAt.getTime() - (task.startedAt?.getTime() ?? task.createdAt.getTime());

    // Update agent stats
    if (task.assignedAgentId) {
      const agent = this.agents.get(task.assignedAgentId);
      if (agent) {
        agent.status = "idle";
        agent.currentTaskId = undefined;
        agent.failedTasks++;
        agent.lastActiveAt = new Date();
      }
    }

    this.emitEvent({ type: "task_failed", task });

    // Auto-reassign if enabled
    if (this.config.autoReassign) {
      this.reassignTask(taskId);
    }

    return true;
  }

  /**
   * Reassign a failed task.
   */
  private reassignTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "failed") return false;

    // Reset task status
    task.status = "pending";
    task.assignedAgentId = undefined;
    task.startedAt = undefined;
    task.error = undefined;

    // Try to auto-assign
    const assigned = this.autoAssign();
    return assigned > 0;
  }

  /**
   * Create a team.
   */
  createTeam(team: Omit<SwarmTeam, "id" | "createdAt">): SwarmTeam {
    const fullTeam: SwarmTeam = {
      ...team,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    };

    this.teams.set(fullTeam.id, fullTeam);
    this.emitEvent({ type: "team_created", team: fullTeam });

    logger.debug("[Swarm] Team created", {
      id: fullTeam.id,
      name: fullTeam.name,
      memberCount: fullTeam.memberIds.length,
    });

    return fullTeam;
  }

  /**
   * Get swarm statistics.
   */
  getStats(): SwarmStats {
    const agents = Array.from(this.agents.values());
    const tasks = Array.from(this.tasks.values());

    const completedTasks = tasks.filter((t) => t.status === "completed");
    const avgDuration = completedTasks.length > 0
      ? completedTasks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0) / completedTasks.length
      : 0;

    return {
      totalAgents: agents.length,
      idleAgents: agents.filter((a) => a.status === "idle").length,
      busyAgents: agents.filter((a) => a.status === "busy").length,
      totalTasks: tasks.length,
      pendingTasks: tasks.filter((t) => t.status === "pending").length,
      runningTasks: tasks.filter((t) => t.status === "running").length,
      completedTasks: completedTasks.length,
      failedTasks: tasks.filter((t) => t.status === "failed").length,
      avgTaskDurationMs: avgDuration,
    };
  }

  /**
   * Get all agents.
   */
  getAgents(): SwarmAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get all tasks.
   */
  getTasks(): SwarmTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get all teams.
   */
  getTeams(): SwarmTeam[] {
    return Array.from(this.teams.values());
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────────────────────

export type SwarmEvent =
  | { type: "agent_registered"; agent: SwarmAgent }
  | { type: "task_created"; task: SwarmTask }
  | { type: "task_assigned"; task: SwarmTask; agent: SwarmAgent }
  | { type: "task_completed"; task: SwarmTask }
  | { type: "task_failed"; task: SwarmTask }
  | { type: "team_created"; team: SwarmTeam };

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let swarmInstance: SwarmManager | null = null;

/**
 * Get the singleton swarm manager.
 */
export function getSwarmManager(config?: Partial<SwarmConfig>): SwarmManager {
  if (!swarmInstance) {
    swarmInstance = new SwarmManager(config);
  }
  return swarmInstance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetSwarmManager(): void {
  swarmInstance = null;
}

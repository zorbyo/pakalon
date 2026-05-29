/**
 * Agent Swarms - Multi-Agent Orchestration
 *
 * Enables multiple agents to work together in a swarm pattern:
 * - Leader agent coordinates the swarm
 * - Worker agents execute tasks
 * - Permission sync between agents
 * - Result aggregation
 * - Swarm lifecycle management
 */

import { randomUUID } from 'crypto';
import logger from '@/utils/logger.js';

export type SwarmRole = 'leader' | 'worker';
export type SwarmStatus = 'forming' | 'ready' | 'executing' | 'completed' | 'failed' | 'dissolved';
export type TaskStatus = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed';

export interface SwarmTask {
  id: string;
  description: string;
  assignedAgentId?: string;
  status: TaskStatus;
  priority: number;
  result?: unknown;
  error?: string;
  createdAt: number;
  assignedAt?: number;
  completedAt?: number;
}

export interface SwarmAgent {
  id: string;
  name: string;
  role: SwarmRole;
  capabilities: string[];
  status: 'idle' | 'busy' | 'completed' | 'failed';
  currentTaskId?: string;
  permissions: string[];
  joinedAt: number;
  completedTasks: string[];
}

export interface SwarmConfig {
  name: string;
  leaderPrompt: string;
  maxWorkers?: number;
  taskTimeoutMs?: number;
  syncPermissions?: boolean;
  autoDissolve?: boolean;
}

export interface SwarmEvent {
  type: 'agent_joined' | 'agent_left' | 'task_assigned' | 'task_completed' | 'task_failed' | 'status_changed';
  swarmId: string;
  agentId?: string;
  taskId?: string;
  timestamp: number;
  data?: unknown;
}

class AgentSwarm {
  private id: string;
  private config: Required<SwarmConfig>;
  private leader?: SwarmAgent;
  private workers: Map<string, SwarmAgent> = new Map();
  private tasks: Map<string, SwarmTask> = new Map();
  private status: SwarmStatus = 'forming';
  private eventListeners: Array<(event: SwarmEvent) => void> = [];
  private permissionSync: Map<string, Set<string>> = new Map();

  constructor(config: SwarmConfig) {
    this.id = `swarm-${randomUUID()}`;
    this.config = {
      maxWorkers: config.maxWorkers ?? 10,
      taskTimeoutMs: config.taskTimeoutMs ?? 300000, // 5 minutes
      syncPermissions: config.syncPermissions ?? true,
      autoDissolve: config.autoDissolve ?? true,
      ...config,
    };
  }

  /**
   * Get swarm ID
   */
  getId(): string {
    return this.id;
  }

  /**
   * Get swarm status
   */
  getStatus(): SwarmStatus {
    return this.status;
  }

  /**
   * Get swarm leader
   */
  getLeader(): SwarmAgent | undefined {
    return this.leader;
  }

  /**
   * Get all workers
   */
  getWorkers(): SwarmAgent[] {
    return Array.from(this.workers.values());
  }

  /**
   * Get all agents
   */
  getAllAgents(): SwarmAgent[] {
    const agents: SwarmAgent[] = [];
    if (this.leader) agents.push(this.leader);
    agents.push(...this.workers.values());
    return agents;
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): SwarmAgent | undefined {
    if (this.leader?.id === agentId) return this.leader;
    return this.workers.get(agentId);
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): SwarmTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all tasks
   */
  getAllTasks(): SwarmTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get pending tasks
   */
  getPendingTasks(): SwarmTask[] {
    return this.getAllTasks().filter(t => t.status === 'pending');
  }

  /**
   * Set the leader agent
   */
  setLeader(agent: { id: string; name: string; capabilities?: string[] }): void {
    this.leader = {
      id: agent.id,
      name: agent.name,
      role: 'leader',
      capabilities: agent.capabilities || [],
      status: 'idle',
      permissions: ['all'],
      joinedAt: Date.now(),
      completedTasks: [],
    };
    this.emit({
      type: 'agent_joined',
      swarmId: this.id,
      agentId: agent.id,
    });
    this.updateStatus('ready');
    logger.debug(`[Swarm:${this.id}] Leader set: ${agent.name}`);
  }

  /**
   * Add a worker agent
   */
  addWorker(agent: { id: string; name: string; capabilities?: string[] }): boolean {
    if (this.workers.size >= this.config.maxWorkers) {
      logger.warn(`[Swarm:${this.id}] Max workers reached`);
      return false;
    }

    const worker: SwarmAgent = {
      id: agent.id,
      name: agent.name,
      role: 'worker',
      capabilities: agent.capabilities || [],
      status: 'idle',
      permissions: [],
      joinedAt: Date.now(),
      completedTasks: [],
    };

    this.workers.set(agent.id, worker);

    // Sync permissions from leader if enabled
    if (this.config.syncPermissions && this.leader) {
      this.syncWorkerPermissions(agent.id);
    }

    this.emit({
      type: 'agent_joined',
      swarmId: this.id,
      agentId: agent.id,
    });

    logger.debug(`[Swarm:${this.id}] Worker added: ${agent.name}`);
    return true;
  }

  /**
   * Remove an agent
   */
  removeAgent(agentId: string): boolean {
    const agent = this.getAgent(agentId);
    if (!agent) return false;

    if (agent.role === 'leader') {
      this.leader = undefined;
    } else {
      this.workers.delete(agentId);
    }

    // Reassign pending tasks from this agent
    for (const task of this.tasks.values()) {
      if (task.assignedAgentId === agentId && task.status === 'pending') {
        task.assignedAgentId = undefined;
      }
    }

    this.emit({
      type: 'agent_left',
      swarmId: this.id,
      agentId,
    });

    logger.debug(`[Swarm:${this.id}] Agent removed: ${agentId}`);
    return true;
  }

  /**
   * Add a task to the swarm
   */
  addTask(description: string, priority = 5): string {
    const task: SwarmTask = {
      id: `task-${randomUUID()}`,
      description,
      status: 'pending',
      priority,
      createdAt: Date.now(),
    };

    this.tasks.set(task.id, task);
    logger.debug(`[Swarm:${this.id}] Task added: ${task.id}`);
    return task.id;
  }

  /**
   * Assign a task to an agent
   */
  assignTask(taskId: string, agentId: string): boolean {
    const task = this.tasks.get(taskId);
    const agent = this.getAgent(agentId);

    if (!task || !agent || task.status !== 'pending') {
      return false;
    }

    task.assignedAgentId = agentId;
    task.status = 'assigned';
    task.assignedAt = Date.now();
    agent.currentTaskId = taskId;
    agent.status = 'busy';

    this.emit({
      type: 'task_assigned',
      swarmId: this.id,
      agentId,
      taskId,
    });

    logger.debug(`[Swarm:${this.id}] Task ${taskId} assigned to ${agentId}`);
    return true;
  }

  /**
   * Complete a task
   */
  completeTask(taskId: string, result: unknown): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    task.status = 'completed';
    task.result = result;
    task.completedAt = Date.now();

    if (task.assignedAgentId) {
      const agent = this.getAgent(task.assignedAgentId);
      if (agent) {
        agent.status = 'idle';
        agent.currentTaskId = undefined;
        agent.completedTasks.push(taskId);
      }
    }

    this.emit({
      type: 'task_completed',
      swarmId: this.id,
      taskId,
    });

    // Check if swarm is complete
    this.checkCompletion();

    logger.debug(`[Swarm:${this.id}] Task ${taskId} completed`);
    return true;
  }

  /**
   * Fail a task
   */
  failTask(taskId: string, error: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    task.status = 'failed';
    task.error = error;
    task.completedAt = Date.now();

    if (task.assignedAgentId) {
      const agent = this.getAgent(task.assignedAgentId);
      if (agent) {
        agent.status = 'failed';
        agent.currentTaskId = undefined;
      }
    }

    this.emit({
      type: 'task_failed',
      swarmId: this.id,
      taskId,
    });

    logger.debug(`[Swarm:${this.id}] Task ${taskId} failed: ${error}`);
    return true;
  }

  /**
   * Sync permissions from leader to worker
   */
  syncWorkerPermissions(workerId: string): void {
    if (!this.leader || !this.config.syncPermissions) return;

    const worker = this.workers.get(workerId);
    if (!worker) return;

    // Worker gets subset of leader permissions (or all if explicitly granted)
    worker.permissions = this.leader.permissions;
    this.permissionSync.set(workerId, new Set(worker.permissions));

    logger.debug(`[Swarm:${this.id}] Permissions synced for worker ${workerId}`);
  }

  /**
   * Update agent permissions
   */
  updateAgentPermissions(agentId: string, permissions: string[]): boolean {
    const agent = this.getAgent(agentId);
    if (!agent) return false;

    agent.permissions = permissions;
    if (this.config.syncPermissions && agent.role === 'leader') {
      // Sync to all workers
      for (const worker of this.workers.values()) {
        worker.permissions = permissions;
        this.permissionSync.set(worker.id, new Set(permissions));
      }
    }

    return true;
  }

  /**
   * Check if agent has permission
   */
  hasPermission(agentId: string, permission: string): boolean {
    const agent = this.getAgent(agentId);
    if (!agent) return false;
    if (agent.permissions.includes('all')) return true;
    return agent.permissions.includes(permission);
  }

  /**
   * Get swarm statistics
   */
  getStats(): {
    id: string;
    status: SwarmStatus;
    totalAgents: number;
    leader?: { id: string; name: string };
    workerCount: number;
    taskStats: {
      total: number;
      pending: number;
      completed: number;
      failed: number;
    };
    syncEnabled: boolean;
  } {
    const taskStats = {
      total: this.tasks.size,
      pending: 0,
      completed: 0,
      failed: 0,
    };

    for (const task of this.tasks.values()) {
      switch (task.status) {
        case 'pending':
        case 'assigned':
        case 'in_progress':
          taskStats.pending++;
          break;
        case 'completed':
          taskStats.completed++;
          break;
        case 'failed':
          taskStats.failed++;
          break;
      }
    }

    return {
      id: this.id,
      status: this.status,
      totalAgents: this.workers.size + (this.leader ? 1 : 0),
      leader: this.leader ? { id: this.leader.id, name: this.leader.name } : undefined,
      workerCount: this.workers.size,
      taskStats,
      syncEnabled: this.config.syncPermissions,
    };
  }

  /**
   * Subscribe to swarm events
   */
  subscribe(listener: (event: SwarmEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      const idx = this.eventListeners.indexOf(listener);
      if (idx >= 0) this.eventListeners.splice(idx, 1);
    };
  }

  /**
   * Emit a swarm event
   */
  private emit(event: Omit<SwarmEvent, 'timestamp'> & Partial<Pick<SwarmEvent, 'timestamp'>>): void {
    const eventWithTimestamp: SwarmEvent = {
      ...event,
      timestamp: event.timestamp ?? Date.now(),
    };

    for (const listener of this.eventListeners) {
      try {
        listener(eventWithTimestamp);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Update swarm status
   */
  private updateStatus(status: SwarmStatus): void {
    if (this.status !== status) {
      const oldStatus = this.status;
      this.status = status;
      this.emit({
        type: 'status_changed',
        swarmId: this.id,
        timestamp: Date.now(),
        data: { from: oldStatus, to: status },
      });
    }
  }

  /**
   * Check if swarm is complete
   */
  private checkCompletion(): void {
    if (this.status !== 'executing') return;

    const pendingTasks = this.getPendingTasks();
    const inProgressTasks = this.getAllTasks().filter(t =>
      t.status === 'assigned' || t.status === 'in_progress'
    );

    if (pendingTasks.length === 0 && inProgressTasks.length === 0) {
      const failedTasks = this.getAllTasks().filter(t => t.status === 'failed');
      this.updateStatus(failedTasks.length > 0 ? 'failed' : 'completed');

      if (this.config.autoDissolve) {
        logger.debug(`[Swarm:${this.id}] All tasks complete, auto-dissolving`);
        // Note: actual dissolution should be handled by the caller
      }
    }
  }

  /**
   * Start swarm execution
   */
  start(): void {
    if (this.status !== 'ready') {
      throw new Error('Swarm must be in ready status to start');
    }
    if (!this.leader) {
      throw new Error('Swarm must have a leader to start');
    }
    this.updateStatus('executing');
    logger.info(`[Swarm:${this.id}] Swarm started`);
  }

  /**
   * Dissolve the swarm
   */
  dissolve(): void {
    this.updateStatus('dissolved');
    this.workers.clear();
    this.tasks.clear();
    this.leader = undefined;
    this.eventListeners = [];
    logger.info(`[Swarm:${this.id}] Swarm dissolved`);
  }
}

// Swarm registry for managing multiple swarms
class SwarmRegistry {
  private swarms: Map<string, AgentSwarm> = new Map();

  createSwarm(config: SwarmConfig): AgentSwarm {
    const swarm = new AgentSwarm(config);
    this.swarms.set(swarm.getId(), swarm);
    logger.debug(`[SwarmRegistry] Created swarm ${swarm.getId()}`);
    return swarm;
  }

  getSwarm(id: string): AgentSwarm | undefined {
    return this.swarms.get(id);
  }

  getAllSwarms(): AgentSwarm[] {
    return Array.from(this.swarms.values());
  }

  dissolveSwarm(id: string): boolean {
    const swarm = this.swarms.get(id);
    if (!swarm) return false;
    swarm.dissolve();
    this.swarms.delete(id);
    return true;
  }

  getActiveSwarms(): AgentSwarm[] {
    return this.getAllSwarms().filter(s => {
      const status = s.getStatus();
      return status !== 'completed' && status !== 'failed' && status !== 'dissolved';
    });
  }
}

const swarmRegistry = new SwarmRegistry();

export function createSwarm(config: SwarmConfig): AgentSwarm {
  return swarmRegistry.createSwarm(config);
}

export function getSwarm(id: string): AgentSwarm | undefined {
  return swarmRegistry.getSwarm(id);
}

export function getAllSwarms(): AgentSwarm[] {
  return swarmRegistry.getAllSwarms();
}

export function dissolveSwarm(id: string): boolean {
  return swarmRegistry.dissolveSwarm(id);
}

export function getActiveSwarms(): AgentSwarm[] {
  return swarmRegistry.getActiveSwarms();
}

export { AgentSwarm, SwarmRegistry };

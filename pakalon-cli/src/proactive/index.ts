/**
 * Proactive Mode - Autonomous Background Work
 *
 * Enables the AI to proactively work on tasks in the background
 * without explicit user prompting. Tasks are queued and
 * executed based on triggers and priorities.
 *
 * Features:
 * - Automatic task detection and suggestion
 * - Background task execution
 * - Task prioritization
 * - Resource management
 * - Result delivery on next user interaction
 */

import { randomUUID } from 'crypto';
import logger from '@/utils/logger.js';
import { getToolResultStorage } from '@/utils/toolResultStorage.js';

export type ProactiveTaskType =
  | 'code_review'
  | 'testing'
  | 'documentation'
  | 'optimization'
  | 'dependency_update'
  | 'security_scan'
  | 'refactoring'
  | 'research'
  | 'monitoring';

export type ProactiveTaskStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ProactiveTask {
  id: string;
  type: ProactiveTaskType;
  description: string;
  priority: number; // 1-10, higher = more important
  status: ProactiveTaskStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
  suggestedBy?: string; // Hook or trigger that suggested this
  context?: {
    files?: string[];
    projectDir?: string;
    relatedTaskId?: string;
  };
}

export interface ProactiveTrigger {
  type: string;
  condition: (ctx: ProactiveContext) => boolean;
  taskType: ProactiveTaskType;
  description: string;
  priority: number;
}

export interface ProactiveContext {
  recentToolCalls?: string[];
  currentPhase?: string;
  projectDir?: string;
  sessionId?: string;
  contextUsage?: number;
  lastUserMessage?: string;
}

export interface ProactiveConfig {
  enabled: boolean;
  maxConcurrentTasks: number;
  maxQueueSize: number;
  checkIntervalMs: number;
  autoStart: boolean;
  minPriority: number;
}

const DEFAULT_CONFIG: ProactiveConfig = {
  enabled: false,
  maxConcurrentTasks: 2,
  maxQueueSize: 10,
  checkIntervalMs: 60000, // 1 minute
  autoStart: false,
  minPriority: 5,
};

class ProactiveModeEngine {
  private config: ProactiveConfig;
  private tasks: Map<string, ProactiveTask> = new Map();
  private triggers: ProactiveTrigger[] = [];
  private runningTasks: Set<string> = new Set();
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private listeners: Array<(tasks: ProactiveTask[]) => void> = [];
  private history: ProactiveTask[] = [];
  private maxHistory = 100;

  constructor(config: Partial<ProactiveConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.registerDefaultTriggers();
  }

  /**
   * Register default proactive triggers
   */
  private registerDefaultTriggers(): void {
    // Code review trigger - after multiple file edits
    this.registerTrigger({
      type: 'file_edit_count',
      condition: (ctx) => (ctx.recentToolCalls?.filter(t => t.includes('Edit') || t.includes('Write')).length ?? 0) >= 5,
      taskType: 'code_review',
      description: 'Multiple file edits detected - suggest code review',
      priority: 7,
    });

    // Testing trigger - after code changes
    this.registerTrigger({
      type: 'code_change_detected',
      condition: (ctx) => (ctx.recentToolCalls?.some(t => t.includes('Edit') || t.includes('Write')) ?? false),
      taskType: 'testing',
      description: 'Code changes detected - suggest testing',
      priority: 8,
    });

    // Documentation trigger - after implementation
    this.registerTrigger({
      type: 'implementation_complete',
      condition: (ctx) => (ctx.recentToolCalls?.some(t => t.includes('Bash') && t.includes('git commit')) ?? false),
      taskType: 'documentation',
      description: 'Code committed - suggest documentation update',
      priority: 5,
    });

    // Security trigger - after dependencies
    this.registerTrigger({
      type: 'dependency_change',
      condition: (ctx) => (ctx.recentToolCalls?.some(t => t.includes('npm install') || t.includes('pip install')) ?? false),
      taskType: 'security_scan',
      description: 'Dependencies changed - suggest security scan',
      priority: 9,
    });

    // Monitoring trigger - during long sessions
    this.registerTrigger({
      type: 'session_duration',
      condition: (ctx) => (ctx.contextUsage ?? 0) > 0.7,
      taskType: 'monitoring',
      description: 'Context usage high - suggest cleanup',
      priority: 6,
    });

    logger.debug('[ProactiveMode] Registered default triggers');
  }

  /**
   * Register a new trigger
   */
  registerTrigger(trigger: ProactiveTrigger): void {
    this.triggers.push(trigger);
    logger.debug(`[ProactiveMode] Registered trigger: ${trigger.type} (${trigger.taskType})`);
  }

  /**
   * Enable proactive mode
   */
  enable(): void {
    this.config.enabled = true;
    if (this.config.autoStart && !this.checkInterval) {
      this.start();
    }
    logger.info('[ProactiveMode] Enabled');
  }

  /**
   * Disable proactive mode
   */
  disable(): void {
    this.config.enabled = false;
    this.stop();
    logger.info('[ProactiveMode] Disabled');
  }

  /**
   * Start the proactive check loop
   */
  start(): void {
    if (!this.config.enabled) {
      logger.warn('[ProactiveMode] Cannot start - not enabled');
      return;
    }

    if (this.checkInterval) {
      logger.debug('[ProactiveMode] Already running');
      return;
    }

    this.checkInterval = setInterval(() => {
      this.evaluateTriggers({
        recentToolCalls: this.getRecentToolCalls(),
      });
    }, this.config.checkIntervalMs);

    logger.info(`[ProactiveMode] Started (interval: ${this.config.checkIntervalMs}ms)`);
  }

  /**
   * Stop the proactive check loop
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('[ProactiveMode] Stopped');
    }
  }

  /**
   * Evaluate all triggers and queue tasks
   */
  async evaluateTriggers(ctx: ProactiveContext): Promise<ProactiveTask[]> {
    if (!this.config.enabled) return [];

    const triggeredTasks: ProactiveTask[] = [];

    for (const trigger of this.triggers) {
      if (trigger.condition(ctx) && this.shouldQueueTask(trigger.taskType)) {
        const task = this.createTask(trigger.taskType, trigger.description, trigger.priority, {
          suggestedBy: trigger.type,
        });

        // Check if similar task already exists
        if (!this.hasSimilarRecentTask(task)) {
          triggeredTasks.push(task);
          this.queueTask(task);
        }
      }
    }

    return triggeredTasks;
  }

  /**
   * Create a new proactive task
   */
  createTask(
    type: ProactiveTaskType,
    description: string,
    priority: number,
    options: Partial<ProactiveTask> = {}
  ): ProactiveTask {
    return {
      id: `proactive-${randomUUID()}`,
      type,
      description,
      priority,
      status: 'pending',
      createdAt: Date.now(),
      ...options,
    };
  }

  /**
   * Queue a task for execution
   */
  queueTask(task: ProactiveTask): boolean {
    if (this.tasks.size >= this.config.maxQueueSize) {
      logger.debug(`[ProactiveMode] Queue full, not queueing: ${task.type}`);
      return false;
    }

    task.status = 'queued';
    this.tasks.set(task.id, task);
    this.notifyListeners();
    logger.debug(`[ProactiveMode] Queued task: ${task.type} - ${task.description}`);
    return true;
  }

  /**
   * Check if a similar task was recently completed
   */
  private hasSimilarRecentTask(task: ProactiveTask): boolean {
    const recentThreshold = 30 * 60 * 1000; // 30 minutes
    const now = Date.now();

    for (const recentTask of this.history) {
      if (now - recentTask.createdAt > recentThreshold) break;
      if (recentTask.type === task.type && recentTask.status === 'completed') {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if task type should be queued
   */
  private shouldQueueTask(type: ProactiveTaskType): boolean {
    const count = Array.from(this.tasks.values()).filter(
      t => t.type === type && (t.status === 'queued' || t.status === 'running')
    ).length;
    return count === 0;
  }

  /**
   * Get a task by ID
   */
  getTask(id: string): ProactiveTask | undefined {
    return this.tasks.get(id);
  }

  /**
   * Get all tasks
   */
  getAllTasks(): ProactiveTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get pending tasks ready for execution
   */
  getPendingTasks(): ProactiveTask[] {
    return this.getAllTasks()
      .filter(t => t.status === 'queued' && t.priority >= this.config.minPriority)
      .slice(0, this.config.maxConcurrentTasks - this.runningTasks.size);
  }

  /**
   * Start executing a task
   */
  startTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'queued') return false;
    if (this.runningTasks.size >= this.config.maxConcurrentTasks) return false;

    task.status = 'running';
    task.startedAt = Date.now();
    this.runningTasks.add(id);
    this.notifyListeners();
    logger.debug(`[ProactiveMode] Started task: ${task.id}`);
    return true;
  }

  /**
   * Complete a task with result
   */
  completeTask(id: string, result: unknown): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'running') return false;

    task.status = 'completed';
    task.completedAt = Date.now();
    task.result = result;
    this.runningTasks.delete(id);
    this.addToHistory(task);
    this.notifyListeners();
    logger.debug(`[ProactiveMode] Completed task: ${task.id}`);
    return true;
  }

  /**
   * Fail a task with error
   */
  failTask(id: string, error: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'running') return false;

    task.status = 'failed';
    task.completedAt = Date.now();
    task.error = error;
    this.runningTasks.delete(id);
    this.addToHistory(task);
    this.notifyListeners();
    logger.debug(`[ProactiveMode] Failed task: ${task.id} - ${error}`);
    return true;
  }

  /**
   * Cancel a task
   */
  cancelTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;

    task.status = 'cancelled';
    this.runningTasks.delete(id);
    this.addToHistory(task);
    this.notifyListeners();
    return true;
  }

  /**
   * Add task to history
   */
  private addToHistory(task: ProactiveTask): void {
    this.history.unshift(task);
    if (this.history.length > this.maxHistory) {
      this.history.pop();
    }
  }

  /**
   * Get proactive task suggestions for user
   */
  getSuggestions(): Array<{ type: ProactiveTaskType; description: string; priority: number }> {
    const suggestions = new Map<ProactiveTaskType, { description: string; priority: number }>();

    for (const trigger of this.triggers) {
      if (!suggestions.has(trigger.taskType) || suggestions.get(trigger.taskType)!.priority < trigger.priority) {
        suggestions.set(trigger.taskType, {
          description: trigger.description,
          priority: trigger.priority,
        });
      }
    }

    return Array.from(suggestions.entries()).map(([type, info]) => ({
      type,
      description: info.description,
      priority: info.priority,
    }));
  }

  /**
   * Execute proactive tasks (for integration with agent loop)
   */
  async executePendingTasks(
    executor: (task: ProactiveTask) => Promise<unknown>
  ): Promise<ProactiveTask[]> {
    const completedTasks: ProactiveTask[] = [];
    const pending = this.getPendingTasks();

    for (const task of pending) {
      this.startTask(task.id);
      try {
        const result = await executor(task);
        this.completeTask(task.id, result);
        completedTasks.push(this.tasks.get(task.id)!);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.failTask(task.id, error);
      }
    }

    return completedTasks;
  }

  /**
   * Get recent tool calls for context
   */
  private getRecentToolCalls(): string[] {
    const storage = getToolResultStorage();
    const stats = storage.getStats();
    // Return tool names that were recently used
    return Object.entries(stats.byTool)
      .flatMap(([tool, count]) => Array(count).fill(tool));
  }

  /**
   * Subscribe to task updates
   */
  subscribe(listener: (tasks: ProactiveTask[]) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /**
   * Notify all listeners of task changes
   */
  private notifyListeners(): void {
    const tasks = this.getAllTasks();
    for (const listener of this.listeners) {
      try {
        listener(tasks);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Get engine statistics
   */
  getStats(): {
    totalTasks: number;
    pendingTasks: number;
    runningTasks: number;
    completedTasks: number;
    failedTasks: number;
    isEnabled: boolean;
    isRunning: boolean;
  } {
    const tasks = this.getAllTasks();
    return {
      totalTasks: tasks.length,
      pendingTasks: tasks.filter(t => t.status === 'queued').length,
      runningTasks: this.runningTasks.size,
      completedTasks: tasks.filter(t => t.status === 'completed').length,
      failedTasks: tasks.filter(t => t.status === 'failed').length,
      isEnabled: this.config.enabled,
      isRunning: this.checkInterval !== null,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<ProactiveConfig>): void {
    this.config = { ...this.config, ...updates };
    logger.debug('[ProactiveMode] Config updated', updates);
  }

  /**
   * Clear all tasks and history
   */
  clear(): void {
    this.tasks.clear();
    this.runningTasks.clear();
    this.history = [];
    this.notifyListeners();
    logger.debug('[ProactiveMode] Cleared');
  }
}

// Singleton instance
let proactiveEngine: ProactiveModeEngine | null = null;

export function getProactiveEngine(config?: Partial<ProactiveConfig>): ProactiveModeEngine {
  if (!proactiveEngine) {
    proactiveEngine = new ProactiveModeEngine(config);
  }
  return proactiveEngine;
}

export function isProactiveModeEnabled(): boolean {
  return proactiveEngine?.getStats().isEnabled ?? false;
}

export function enableProactiveMode(): void {
  getProactiveEngine().enable();
}

export function disableProactiveMode(): void {
  getProactiveEngine().disable();
}

export {
  ProactiveModeEngine,
  type ProactiveTask,
  type ProactiveTaskType,
  type ProactiveTaskStatus,
  type ProactiveTrigger,
  type ProactiveContext,
  type ProactiveConfig,
};
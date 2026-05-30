/**
 * Task Lifecycle Hooks
 * Advanced pre/post task execution hooks for task orchestration
 */

export type HookType = 'beforeCreate' | 'afterCreate' | 'beforeStart' | 'afterStart' | 'beforeComplete' | 'afterComplete' | 'beforeFail' | 'afterFail' | 'beforeCancel' | 'afterCancel';

export interface TaskHookContext {
  taskId: string;
  taskSubject: string;
  taskStatus: string;
  previousStatus?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface TaskHookResult {
  proceed: boolean;
  modify?: {
    subject?: string;
    description?: string;
    priority?: string;
    metadata?: Record<string, unknown>;
  };
  reason?: string;
}

export type TaskHook = (context: TaskHookContext) => Promise<TaskHookResult> | TaskHookResult;

interface RegisteredHook {
  id: string;
  type: HookType;
  hook: TaskHook;
  priority: number;
  enabled: boolean;
}

class TaskLifecycleManager {
  private hooks = new Map<HookType, RegisteredHook[]>();
  private hookIdCounter = 0;

  /**
   * Register a lifecycle hook
   */
  registerHook(type: HookType, hook: TaskHook, priority: number = 0): string {
    const hookId = `hook_${++this.hookIdCounter}`;
    const registered: RegisteredHook = {
      id: hookId,
      type,
      hook,
      priority,
      enabled: true,
    };

    const hooks = this.hooks.get(type) || [];
    hooks.push(registered);
    hooks.sort((a, b) => b.priority - a.priority);
    this.hooks.set(type, hooks);

    return hookId;
  }

  /**
   * Unregister a lifecycle hook
   */
  unregisterHook(hookId: string): boolean {
    for (const [type, hooks] of this.hooks.entries()) {
      const index = hooks.findIndex((h) => h.id === hookId);
      if (index !== -1) {
        hooks.splice(index, 1);
        this.hooks.set(type, hooks);
        return true;
      }
    }
    return false;
  }

  /**
   * Enable/disable a hook
   */
  setHookEnabled(hookId: string, enabled: boolean): boolean {
    for (const hooks of this.hooks.values()) {
      const hook = hooks.find((h) => h.id === hookId);
      if (hook) {
        hook.enabled = enabled;
        return true;
      }
    }
    return false;
  }

  /**
   * Execute all hooks for a given type
   */
  async executeHooks(type: HookType, context: TaskHookContext): Promise<TaskHookResult> {
    const hooks = this.hooks.get(type) || [];
    const enabledHooks = hooks.filter((h) => h.enabled);

    let combinedResult: TaskHookResult = { proceed: true };

    for (const registered of enabledHooks) {
      try {
        const result = await registered.hook(context);

        if (!result.proceed) {
          return result;
        }

        if (result.modify) {
          combinedResult = {
            ...combinedResult,
            modify: {
              ...combinedResult.modify,
              ...result.modify,
            },
          };
        }
      } catch (error) {
        console.error(`[TaskLifecycle] Hook ${registered.id} failed:`, error);
      }
    }

    return combinedResult;
  }

  /**
   * Get all hooks for a type
   */
  getHooks(type: HookType): RegisteredHook[] {
    return this.hooks.get(type) || [];
  }

  /**
   * Get all registered hooks
   */
  getAllHooks(): Map<HookType, RegisteredHook[]> {
    return new Map(this.hooks);
  }

  /**
   * Clear all hooks
   */
  clearAllHooks(): void {
    this.hooks.clear();
  }
}

// Singleton instance
export const taskLifecycleManager = new TaskLifecycleManager();

// Built-in hooks
export const validationHook: TaskHook = async (context) => {
  if (!context.taskSubject || context.taskSubject.trim().length === 0) {
    return {
      proceed: false,
      reason: 'Task subject cannot be empty',
    };
  }
  return { proceed: true };
};

export const loggingHook: TaskHook = async (context) => {
  console.log(`[TaskLifecycle] ${context.timestamp}: Task #${context.taskId} (${context.taskSubject}) - Status: ${context.taskStatus}`);
  return { proceed: true };
};

export const priorityBoostHook: TaskHook = async (context) => {
  if (context.taskStatus === 'in_progress' && context.previousStatus === 'pending') {
    return {
      proceed: true,
      modify: {
        metadata: {
          startedAt: Date.now(),
        },
      },
    };
  }
  return { proceed: true };
};

// Register built-in hooks
taskLifecycleManager.registerHook('beforeCreate', validationHook, 100);
taskLifecycleManager.registerHook('afterCreate', loggingHook, 0);
taskLifecycleManager.registerHook('beforeStart', priorityBoostHook, 50);

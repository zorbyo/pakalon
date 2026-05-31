/**
 * Tool Hooks System
 * 
 * Implements beforeToolCall/afterToolCall hooks for the tool execution pipeline.
 * Based on pi's hook system.
 * 
 * Features:
 * - beforeToolCall: Can block execution, modify args, or allow
 * - afterToolCall: Can modify results, add metadata, or terminate
 * - Priority-based ordering
 * - Filter by tool name
 * - Cleanup/disposal support
 */

import logger from '@/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface ToolCallContext {
  toolName: string;
  args: Record<string, unknown>;
  sessionId?: string;
  agentId?: string;
  timestamp: number;
}

export interface BeforeToolCallResult {
  /** "allow" lets execution proceed. "deny" blocks it. "modify" changes args. */
  action: 'allow' | 'deny' | 'modify';
  /** Modified tool arguments (only when action = "modify") */
  modifiedArgs?: Record<string, unknown>;
  /** Reason for deny (shown to user) */
  reason?: string;
}

export interface AfterToolCallContext {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  isError: boolean;
  durationMs: number;
  sessionId?: string;
  agentId?: string;
  timestamp: number;
}

export interface AfterToolCallResult {
  /** Modified result (if provided) */
  result?: unknown;
  /** Modified error state (if provided) */
  isError?: boolean;
  /** Additional metadata to attach */
  metadata?: Record<string, unknown>;
  /** Hint to skip the automatic follow-up LLM call */
  terminate?: boolean;
}

export interface ToolHookRegistration {
  id: string;
  hookType: 'before' | 'after';
  /** Optional filter — only fire for matching tool names */
  match?: string | string[];
  /** Priority (lower = runs first) */
  priority: number;
  handler: (ctx: any) => Promise<any>;
  /** Cleanup function called on disposal */
  cleanup?: () => void | Promise<void>;
}

// ============================================================================
// Tool Hook Manager
// ============================================================================

export class ToolHookManager {
  private registrations: Map<string, ToolHookRegistration> = new Map();
  private nextId = 1;

  /**
   * Register a beforeToolCall hook
   */
  onBeforeToolCall(
    handler: (ctx: ToolCallContext) => Promise<BeforeToolCallResult>,
    options?: {
      match?: string | string[];
      priority?: number;
      cleanup?: () => void | Promise<void>;
    }
  ): () => void {
    const id = `before-${this.nextId++}`;
    const registration: ToolHookRegistration = {
      id,
      hookType: 'before',
      match: options?.match,
      priority: options?.priority ?? 10,
      handler,
      cleanup: options?.cleanup,
    };
    this.registrations.set(id, registration);
    logger.debug('[tool-hooks] Registered beforeToolCall hook', { id, match: options?.match });
    return () => this.unregister(id);
  }

  /**
   * Register an afterToolCall hook
   */
  onAfterToolCall(
    handler: (ctx: AfterToolCallContext) => Promise<AfterToolCallResult>,
    options?: {
      match?: string | string[];
      priority?: number;
      cleanup?: () => void | Promise<void>;
    }
  ): () => void {
    const id = `after-${this.nextId++}`;
    const registration: ToolHookRegistration = {
      id,
      hookType: 'after',
      match: options?.match,
      priority: options?.priority ?? 10,
      handler,
      cleanup: options?.cleanup,
    };
    this.registrations.set(id, registration);
    logger.debug('[tool-hooks] Registered afterToolCall hook', { id, match: options?.match });
    return () => this.unregister(id);
  }

  /**
   * Unregister a hook
   */
  unregister(id: string): void {
    const registration = this.registrations.get(id);
    if (registration) {
      this.registrations.delete(id);
      logger.debug('[tool-hooks] Unregistered hook', { id });
    }
  }

  /**
   * Run beforeToolCall hooks
   */
  async runBeforeToolCall(ctx: ToolCallContext): Promise<BeforeToolCallResult> {
    const hooks = this.getMatchingHooks('before', ctx.toolName);
    
    for (const hook of hooks) {
      try {
        const result = await hook.handler(ctx);
        if (result.action === 'deny') {
          logger.debug('[tool-hooks] Tool call denied', { hookId: hook.id, toolName: ctx.toolName, reason: result.reason });
          return result;
        }
        if (result.action === 'modify' && result.modifiedArgs) {
          ctx.args = result.modifiedArgs;
        }
      } catch (error) {
        logger.error('[tool-hooks] beforeToolCall hook error', { hookId: hook.id, error: String(error) });
      }
    }

    return { action: 'allow' };
  }

  /**
   * Run afterToolCall hooks
   */
  async runAfterToolCall(ctx: AfterToolCallContext): Promise<AfterToolCallResult> {
    const hooks = this.getMatchingHooks('after', ctx.toolName);
    let result = ctx.result;
    let isError = ctx.isError;
    let terminate = false;
    const metadata: Record<string, unknown> = {};

    for (const hook of hooks) {
      try {
        const hookResult = await hook.handler(ctx);
        if (hookResult.result !== undefined) {
          result = hookResult.result;
        }
        if (hookResult.isError !== undefined) {
          isError = hookResult.isError;
        }
        if (hookResult.terminate) {
          terminate = true;
        }
        if (hookResult.metadata) {
          Object.assign(metadata, hookResult.metadata);
        }
      } catch (error) {
        logger.error('[tool-hooks] afterToolCall hook error', { hookId: hook.id, error: String(error) });
      }
    }

    return {
      result,
      isError,
      terminate,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };
  }

  /**
   * Get hooks matching a tool name
   */
  private getMatchingHooks(hookType: 'before' | 'after', toolName: string): ToolHookRegistration[] {
    const hooks = Array.from(this.registrations.values())
      .filter(r => r.hookType === hookType)
      .filter(r => {
        if (!r.match) return true;
        if (Array.isArray(r.match)) return r.match.includes(toolName);
        return r.match === toolName;
      })
      .sort((a, b) => a.priority - b.priority);

    return hooks;
  }

  /**
   * Clear all hooks
   */
  async clear(): Promise<void> {
    for (const registration of this.registrations.values()) {
      if (registration.cleanup) {
        try {
          await registration.cleanup();
        } catch (error) {
          logger.error('[tool-hooks] Cleanup error', { hookId: registration.id, error: String(error) });
        }
      }
    }
    this.registrations.clear();
    logger.debug('[tool-hooks] Cleared all hooks');
  }

  /**
   * Get hook count
   */
  get size(): number {
    return this.registrations.size;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _globalManager: ToolHookManager | null = null;

export function getToolHookManager(): ToolHookManager {
  if (!_globalManager) {
    _globalManager = new ToolHookManager();
  }
  return _globalManager;
}

export function resetToolHookManager(): void {
  _globalManager = null;
}

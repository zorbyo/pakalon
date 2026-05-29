/**
 * Complete Hook System — All 22 hook types with typed triggers, registry, and scope management.
 *
 * Provides comprehensive hook coverage:
 * - PreToolUse, PostToolUse, PostToolUseFailure
 * - PreCompact, PostCompact
 * - SessionStart, SessionStop
 * - UserPromptSubmit
 * - PreSampling, PostSampling
 * - SubagentStart, SubagentEnd
 * - BeforeProviderRequest, BeforeProviderPayload, AfterProviderResponse
 * - SavePoint, Abort, Settled
 * - QueueUpdate, ModelSelect, ResourcesUpdate
 * - SystemPromptBuild, ContextTransform
 *
 * Port from Claude Code and Pi's hook patterns.
 */

import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type HookEventName =
  | "PreToolUse" | "PostToolUse" | "PostToolUseFailure"
  | "PreCompact" | "PostCompact"
  | "SessionStart" | "SessionStop"
  | "UserPromptSubmit"
  | "PreSampling" | "PostSampling"
  | "SubagentStart" | "SubagentEnd"
  | "BeforeProviderRequest" | "BeforeProviderPayload" | "AfterProviderResponse"
  | "SavePoint" | "Abort" | "Settled"
  | "QueueUpdate" | "ModelSelect" | "ResourcesUpdate"
  | "SystemPromptBuild" | "ContextTransform";

export interface HookEventPayload {
  event: HookEventName;
  input: Record<string, unknown>;
  context: Record<string, unknown>;
  startTime: number;
}

export interface HookResult {
  allowed: boolean;
  output?: unknown;
  warnings?: string[];
  blocked?: boolean;
  error?: string;
}

export interface HookScope {
  type: "global" | "session" | "agent" | "tool";
  value?: string;
}

export interface TypedHookDefinition {
  id: string;
  name: string;
  event: HookEventName;
  priority: number;
  enabled: boolean;
  scope: HookScope;
  handler: (payload: HookEventPayload) => Promise<HookResult> | HookResult;
  description?: string;
  pluginId?: string;
}

export interface HookRegistryEntry {
  hook: TypedHookDefinition;
  registeredAt: Date;
  lastExecutedAt?: Date;
  executionCount: number;
  errorCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Complete Hook Manager
// ─────────────────────────────────────────────────────────────────────────────

export class CompleteHookManager {
  private hooks: Map<HookEventName, HookRegistryEntry[]> = new Map();
  private hookIdCounter = 0;

  /**
   * Register a typed hook.
   */
  register(
    event: HookEventName,
    name: string,
    handler: TypedHookDefinition["handler"],
    options?: {
      priority?: number;
      scope?: HookScope;
      pluginId?: string;
      description?: string;
    }
  ): () => void {
    const hook: TypedHookDefinition = {
      id: `hook_${++this.hookIdCounter}_${Date.now()}`,
      name,
      event,
      priority: options?.priority ?? 0,
      enabled: true,
      scope: options?.scope ?? { type: "global" },
      handler,
      pluginId: options?.pluginId,
      description: options?.description,
    };

    const entry: HookRegistryEntry = {
      hook,
      registeredAt: new Date(),
      executionCount: 0,
      errorCount: 0,
    };

    const hooks = this.hooks.get(event) ?? [];
    hooks.push(entry);
    hooks.sort((a, b) => b.hook.priority - a.hook.priority);
    this.hooks.set(event, hooks);

    logger.debug("[CompleteHooks] Registered", { event, name, id: hook.id });
    return () => this.unregister(hook.id);
  }

  /**
   * Unregister a hook by ID.
   */
  unregister(hookId: string): boolean {
    for (const [event, entries] of this.hooks) {
      const index = entries.findIndex((e) => e.hook.id === hookId);
      if (index !== -1) {
        entries.splice(index, 1);
        if (entries.length === 0) {
          this.hooks.delete(event);
        }
        logger.debug("[CompleteHooks] Unregistered", { hookId });
        return true;
      }
    }
    return false;
  }

  /**
   * Execute all hooks for an event.
   */
  async execute(
    event: HookEventName,
    payload: HookEventPayload
  ): Promise<HookResult> {
    const entries = this.hooks.get(event) ?? [];
    let allowed = true;
    const warnings: string[] = [];
    let output: unknown;

    for (const entry of entries) {
      if (!entry.hook.enabled) continue;

      // Check scope
      if (!this.scopeMatches(entry.hook.scope, payload.context)) continue;

      try {
        const result = await entry.hook.handler(payload);
        entry.lastExecutedAt = new Date();
        entry.executionCount++;

        if (!result.allowed) {
          allowed = false;
        }

        if (result.warnings) {
          warnings.push(...result.warnings);
        }

        if (result.output !== undefined) {
          output = result.output;
        }

        if (result.blocked) {
          return { allowed: false, blocked: true, error: result.error, warnings };
        }
      } catch (error) {
        entry.errorCount++;
        logger.error("[CompleteHooks] Hook error", {
          event,
          hook: entry.hook.name,
          error: String(error),
        });
        warnings.push(`Hook ${entry.hook.name} error: ${error}`);
      }
    }

    return { allowed, output, warnings };
  }

  /**
   * Execute hooks and check if execution should proceed.
   */
  async shouldProceed(
    event: HookEventName,
    payload: HookEventPayload
  ): Promise<boolean> {
    const result = await this.execute(event, payload);
    return result.allowed;
  }

  /**
   * Get all hooks for an event.
   */
  getHooksForEvent(event: HookEventName): HookRegistryEntry[] {
    return [...(this.hooks.get(event) ?? [])];
  }

  /**
   * Get all registered hooks.
   */
  getAllHooks(): HookRegistryEntry[] {
    const all: HookRegistryEntry[] = [];
    for (const entries of this.hooks.values()) {
      all.push(...entries);
    }
    return all;
  }

  /**
   * Enable/disable a hook.
   */
  toggle(hookId: string, enabled: boolean): boolean {
    for (const entries of this.hooks.values()) {
      const entry = entries.find((e) => e.hook.id === hookId);
      if (entry) {
        entry.hook.enabled = enabled;
        return true;
      }
    }
    return false;
  }

  /**
   * Clear all hooks.
   */
  clearAll(): void {
    this.hooks.clear();
    logger.debug("[CompleteHooks] Cleared all hooks");
  }

  /**
   * Clear hooks for a plugin.
   */
  clearPlugin(pluginId: string): void {
    for (const [event, entries] of this.hooks) {
      const filtered = entries.filter((e) => e.hook.pluginId !== pluginId);
      if (filtered.length === 0) {
        this.hooks.delete(event);
      } else {
        this.hooks.set(event, filtered);
      }
    }
    logger.debug("[CompleteHooks] Cleared plugin hooks", { pluginId });
  }

  /**
   * Get hook statistics.
   */
  getStats(): {
    totalHooks: number;
    hooksByEvent: Record<string, number>;
    totalExecutions: number;
    totalErrors: number;
  } {
    const hooksByEvent: Record<string, number> = {};
    let totalExecutions = 0;
    let totalErrors = 0;

    for (const [event, entries] of this.hooks) {
      hooksByEvent[event] = entries.length;
      for (const entry of entries) {
        totalExecutions += entry.executionCount;
        totalErrors += entry.errorCount;
      }
    }

    return {
      totalHooks: this.getAllHooks().length,
      hooksByEvent,
      totalExecutions,
      totalErrors,
    };
  }

  private scopeMatches(scope: HookScope, context: Record<string, unknown>): boolean {
    if (scope.type === "global") return true;

    switch (scope.type) {
      case "session":
        return context.sessionId === scope.value;
      case "agent":
        return context.agentId === scope.value;
      case "tool":
        return context.toolName === scope.value;
      default:
        return false;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let managerInstance: CompleteHookManager | null = null;

/**
 * Get the singleton complete hook manager.
 */
export function getCompleteHookManager(): CompleteHookManager {
  if (!managerInstance) {
    managerInstance = new CompleteHookManager();
  }
  return managerInstance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetCompleteHookManager(): void {
  managerInstance = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience Registration Functions
// ─────────────────────────────────────────────────────────────────────────────

export function registerPreToolUseHook(
  name: string,
  handler: TypedHookDefinition["handler"],
  options?: { priority?: number; scope?: HookScope; pluginId?: string }
): () => void {
  return getCompleteHookManager().register("PreToolUse", name, handler, options);
}

export function registerPostToolUseHook(
  name: string,
  handler: TypedHookDefinition["handler"],
  options?: { priority?: number; scope?: HookScope; pluginId?: string }
): () => void {
  return getCompleteHookManager().register("PostToolUse", name, handler, options);
}

export function registerPostToolUseFailureHook(
  name: string,
  handler: TypedHookDefinition["handler"],
  options?: { priority?: number; scope?: HookScope; pluginId?: string }
): () => void {
  return getCompleteHookManager().register("PostToolUseFailure", name, handler, options);
}

export function registerPreCompactHook(
  name: string,
  handler: TypedHookDefinition["handler"],
  options?: { priority?: number; scope?: HookScope; pluginId?: string }
): () => void {
  return getCompleteHookManager().register("PreCompact", name, handler, options);
}

export function registerPostCompactHook(
  name: string,
  handler: TypedHookDefinition["handler"],
  options?: { priority?: number; scope?: HookScope; pluginId?: string }
): () => void {
  return getCompleteHookManager().register("PostCompact", name, handler, options);
}

export function registerSessionStartHook(
  name: string,
  handler: TypedHookDefinition["handler"],
  options?: { priority?: number; scope?: HookScope; pluginId?: string }
): () => void {
  return getCompleteHookManager().register("SessionStart", name, handler, options);
}

export function registerSessionStopHook(
  name: string,
  handler: TypedHookDefinition["handler"],
  options?: { priority?: number; scope?: HookScope; pluginId?: string }
): () => void {
  return getCompleteHookManager().register("SessionStop", name, handler, options);
}

export function registerUserPromptSubmitHook(
  name: string,
  handler: TypedHookDefinition["handler"],
  options?: { priority?: number; scope?: HookScope; pluginId?: string }
): () => void {
  return getCompleteHookManager().register("UserPromptSubmit", name, handler, options);
}

export function registerPreSamplingHook(
  name: string,
  handler: TypedHookDefinition["handler"],
  options?: { priority?: number; scope?: HookScope; pluginId?: string }
): () => void {
  return getCompleteHookManager().register("PreSampling", name, handler, options);
}

export function registerPostSamplingHook(
  name: string,
  handler: TypedHookDefinition["handler"],
  options?: { priority?: number; scope?: HookScope; pluginId?: string }
): () => void {
  return getCompleteHookManager().register("PostSampling", name, handler, options);
}

export function registerSubagentStartHook(
  name: string,
  handler: TypedHookDefinition["handler"],
  options?: { priority?: number; scope?: HookScope; pluginId?: string }
): () => void {
  return getCompleteHookManager().register("SubagentStart", name, handler, options);
}

export function registerSubagentEndHook(
  name: string,
  handler: TypedHookDefinition["handler"],
  options?: { priority?: number; scope?: HookScope; pluginId?: string }
): () => void {
  return getCompleteHookManager().register("SubagentEnd", name, handler, options);
}

export function registerBeforeProviderRequestHook(
  name: string,
  handler: TypedHookDefinition["handler"],
  options?: { priority?: number; scope?: HookScope; pluginId?: string }
): () => void {
  return getCompleteHookManager().register("BeforeProviderRequest", name, handler, options);
}

export function registerBeforeProviderPayloadHook(
  name: string,
  handler: TypedHookDefinition["handler"],
  options?: { priority?: number; scope?: HookScope; pluginId?: string }
): () => void {
  return getCompleteHookManager().register("BeforeProviderPayload", name, handler, options);
}

export function registerAfterProviderResponseHook(
  name: string,
  handler: TypedHookDefinition["handler"],
  options?: { priority?: number; scope?: HookScope; pluginId?: string }
): () => void {
  return getCompleteHookManager().register("AfterProviderResponse", name, handler, options);
}

export function registerSavePointHook(
  name: string,
  handler: TypedHookDefinition["handler"],
  options?: { priority?: number; scope?: HookScope; pluginId?: string }
): () => void {
  return getCompleteHookManager().register("SavePoint", name, handler, options);
}

export function registerAbortHook(
  name: string,
  handler: TypedHookDefinition["handler"],
  options?: { priority?: number; scope?: HookScope; pluginId?: string }
): () => void {
  return getCompleteHookManager().register("Abort", name, handler, options);
}

export function registerSettledHook(
  name: string,
  handler: TypedHookDefinition["handler"],
  options?: { priority?: number; scope?: HookScope; pluginId?: string }
): () => void {
  return getCompleteHookManager().register("Settled", name, handler, options);
}

export function registerQueueUpdateHook(
  name: string,
  handler: TypedHookDefinition["handler"],
  options?: { priority?: number; scope?: HookScope; pluginId?: string }
): () => void {
  return getCompleteHookManager().register("QueueUpdate", name, handler, options);
}

export function registerModelSelectHook(
  name: string,
  handler: TypedHookDefinition["handler"],
  options?: { priority?: number; scope?: HookScope; pluginId?: string }
): () => void {
  return getCompleteHookManager().register("ModelSelect", name, handler, options);
}

export function registerResourcesUpdateHook(
  name: string,
  handler: TypedHookDefinition["handler"],
  options?: { priority?: number; scope?: HookScope; pluginId?: string }
): () => void {
  return getCompleteHookManager().register("ResourcesUpdate", name, handler, options);
}

export function registerSystemPromptBuildHook(
  name: string,
  handler: TypedHookDefinition["handler"],
  options?: { priority?: number; scope?: HookScope; pluginId?: string }
): () => void {
  return getCompleteHookManager().register("SystemPromptBuild", name, handler, options);
}

export function registerContextTransformHook(
  name: string,
  handler: TypedHookDefinition["handler"],
  options?: { priority?: number; scope?: HookScope; pluginId?: string }
): () => void {
  return getCompleteHookManager().register("ContextTransform", name, handler, options);
}

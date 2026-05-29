/**
 * Typed Plugin Hook Triggers — Typed hook system for plugins.
 *
 * Provides typed hook triggers:
 * - HookSpec definition for type-safe hooks
 * - trigger() and triggerFor() methods
 * - Draft-based output modification
 * - Scoped hook execution with cleanup
 * - Hook registry with priority
 *
 * Port from Opencode's Plugin.Service pattern.
 */

import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type HookSpec = {
  /** Hook input type */
  input: unknown;
  /** Hook output type */
  output: unknown;
};

export type HookMap = Record<string, HookSpec>;

export interface TypedHook<T extends HookSpec = HookSpec> {
  /** Hook ID */
  id: string;
  /** Hook name */
  name: string;
  /** Plugin that registered this hook */
  pluginId: string;
  /** Priority (higher = earlier) */
  priority: number;
  /** Whether hook is enabled */
  enabled: boolean;
  /** Hook handler */
  handler: (input: T["input"]) => Promise<T["output"] | void> | T["output"] | void;
  /** Hook scope */
  scope: HookScope;
}

export type HookScope =
  | { type: "global" } // Applies to all instances
  | { type: "session"; sessionId: string } // Applies to specific session
  | { type: "agent"; agentId: string } // Applies to specific agent
  | { type: "tool"; toolName: string }; // Applies to specific tool

export interface HookTriggerResult<T extends HookSpec = HookSpec> {
  /** Whether the hook chain was successful */
  success: boolean;
  /** Results from all hooks */
  results: Array<{
    hookId: string;
    pluginId: string;
    result: T["output"] | void;
    error?: string;
  }>;
  /** Final output after all hooks */
  finalOutput: T["output"] | undefined;
  /** Whether any hook blocked execution */
  blocked: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed Hook Registry
// ─────────────────────────────────────────────────────────────────────────────

export class TypedHookRegistry {
  private hooks: Map<string, TypedHook[]> = new Map();
  private hookIdCounter = 0;

  /**
   * Register a typed hook.
   */
  register<T extends HookSpec>(
    hookName: string,
    pluginId: string,
    handler: TypedHook<T>["handler"],
    options?: {
      priority?: number;
      scope?: HookScope;
    }
  ): () => void {
    const hook: TypedHook<T> = {
      id: `typed_${++this.hookIdCounter}_${Date.now()}`,
      name: hookName,
      pluginId,
      priority: options?.priority ?? 0,
      enabled: true,
      handler,
      scope: options?.scope ?? { type: "global" },
    };

    const hooks = this.hooks.get(hookName) ?? [];
    hooks.push(hook as unknown as TypedHook);
    hooks.sort((a, b) => b.priority - a.priority);
    this.hooks.set(hookName, hooks);

    logger.debug("[TypedHooks] Registered", {
      hookName,
      pluginId,
      id: hook.id,
    });

    return () => this.unregister(hook.id);
  }

  /**
   * Unregister a hook by ID.
   */
  unregister(hookId: string): boolean {
    for (const [hookName, hooks] of this.hooks) {
      const index = hooks.findIndex((h) => h.id === hookId);
      if (index !== -1) {
        hooks.splice(index, 1);
        if (hooks.length === 0) {
          this.hooks.delete(hookName);
        }
        logger.debug("[TypedHooks] Unregistered", { hookId });
        return true;
      }
    }
    return false;
  }

  /**
   * Trigger all hooks for a hook name.
   */
  async trigger<T extends HookSpec>(
    hookName: string,
    input: T["input"]
  ): Promise<HookTriggerResult<T>> {
    const hooks = this.getHooksForName(hookName);
    const results: HookTriggerResult<T>["results"] = [];
    let blocked = false;
    let finalOutput: T["output"] | undefined;

    for (const hook of hooks) {
      if (!hook.enabled) continue;

      try {
        const result = await (hook.handler as TypedHook<T>["handler"])(input);
        results.push({
          hookId: hook.id,
          pluginId: hook.pluginId,
          result,
        });

        if (result !== undefined && result !== null) {
          finalOutput = result;
        }
      } catch (error) {
        results.push({
          hookId: hook.id,
          pluginId: hook.pluginId,
          result: undefined,
          error: String(error),
        });
        logger.error("[TypedHooks] Hook error", {
          hookName,
          hookId: hook.id,
          error: String(error),
        });
      }
    }

    return {
      success: results.every((r) => !r.error),
      results,
      finalOutput,
      blocked,
    };
  }

  /**
   * Trigger hooks for a specific scope.
   */
  async triggerFor<T extends HookSpec>(
    hookName: string,
    input: T["input"],
    scope: HookScope
  ): Promise<HookTriggerResult<T>> {
    const allHooks = this.getHooksForName(hookName);
    const scopedHooks = allHooks.filter(
      (h) => this.scopeMatches(h.scope, scope)
    );

    const results: HookTriggerResult<T>["results"] = [];
    let blocked = false;
    let finalOutput: T["output"] | undefined;

    for (const hook of scopedHooks) {
      if (!hook.enabled) continue;

      try {
        const result = await (hook.handler as TypedHook<T>["handler"])(input);
        results.push({
          hookId: hook.id,
          pluginId: hook.pluginId,
          result,
        });

        if (result !== undefined && result !== null) {
          finalOutput = result;
        }
      } catch (error) {
        results.push({
          hookId: hook.id,
          pluginId: hook.pluginId,
          result: undefined,
          error: String(error),
        });
      }
    }

    return {
      success: results.every((r) => !r.error),
      results,
      finalOutput,
      blocked,
    };
  }

  /**
   * Get all hooks for a hook name.
   */
  getHooksForName(hookName: string): TypedHook[] {
    return [...(this.hooks.get(hookName) ?? [])];
  }

  /**
   * Get all hooks for a plugin.
   */
  getHooksForPlugin(pluginId: string): TypedHook[] {
    const all: TypedHook[] = [];
    for (const hooks of this.hooks.values()) {
      all.push(...hooks.filter((h) => h.pluginId === pluginId));
    }
    return all;
  }

  /**
   * Enable/disable a hook.
   */
  toggle(hookId: string, enabled: boolean): boolean {
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
   * Clear all hooks for a plugin.
   */
  clearPlugin(pluginId: string): void {
    for (const [hookName, hooks] of this.hooks) {
      const filtered = hooks.filter((h) => h.pluginId !== pluginId);
      if (filtered.length === 0) {
        this.hooks.delete(hookName);
      } else {
        this.hooks.set(hookName, filtered);
      }
    }
    logger.debug("[TypedHooks] Cleared plugin hooks", { pluginId });
  }

  /**
   * Clear all hooks.
   */
  clearAll(): void {
    this.hooks.clear();
    logger.debug("[TypedHooks] Cleared all hooks");
  }

  private scopeMatches(hookScope: HookScope, targetScope: HookScope): boolean {
    if (hookScope.type === "global") return true;
    if (hookScope.type !== targetScope.type) return false;

    switch (hookScope.type) {
      case "session":
        return hookScope.sessionId === (targetScope as { sessionId: string }).sessionId;
      case "agent":
        return hookScope.agentId === (targetScope as { agentId: string }).agentId;
      case "tool":
        return hookScope.toolName === (targetScope as { toolName: string }).toolName;
      default:
        return false;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-defined Hook Specs
// ─────────────────────────────────────────────────────────────────────────────

export interface PreToolUseHookSpec extends HookSpec {
  input: {
    toolName: string;
    args: Record<string, unknown>;
    sessionId?: string;
  };
  output: {
    allowed: boolean;
    modifiedArgs?: Record<string, unknown>;
    reason?: string;
  };
}

export interface PostToolUseHookSpec extends HookSpec {
  input: {
    toolName: string;
    args: Record<string, unknown>;
    result: unknown;
    durationMs: number;
    sessionId?: string;
  };
  output: {
    modifiedResult?: unknown;
    shouldRetry?: boolean;
  };
}

export interface PromptSubmitHookSpec extends HookSpec {
  input: {
    prompt: string;
    sessionId?: string;
    userId?: string;
  };
  output: {
    allowed: boolean;
    modifiedPrompt?: string;
    reason?: string;
  };
}

export interface CompactionHookSpec extends HookSpec {
  input: {
    messages: unknown[];
    tokenCount: number;
    maxTokens: number;
    sessionId?: string;
  };
  output: {
    shouldCompact: boolean;
    modifiedMessages?: unknown[];
    reason?: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let registryInstance: TypedHookRegistry | null = null;

/**
 * Get the singleton typed hook registry.
 */
export function getTypedHookRegistry(): TypedHookRegistry {
  if (!registryInstance) {
    registryInstance = new TypedHookRegistry();
  }
  return registryInstance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetTypedHookRegistry(): void {
  registryInstance = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register a PreToolUse hook.
 */
export function registerPreToolUseHook(
  pluginId: string,
  handler: TypedHook<PreToolUseHookSpec>["handler"],
  options?: { priority?: number; scope?: HookScope }
): () => void {
  return getTypedHookRegistry().register<PreToolUseHookSpec>(
    "PreToolUse",
    pluginId,
    handler,
    options
  );
}

/**
 * Register a PostToolUse hook.
 */
export function registerPostToolUseHook(
  pluginId: string,
  handler: TypedHook<PostToolUseHookSpec>["handler"],
  options?: { priority?: number; scope?: HookScope }
): () => void {
  return getTypedHookRegistry().register<PostToolUseHookSpec>(
    "PostToolUse",
    pluginId,
    handler,
    options
  );
}

/**
 * Register a PromptSubmit hook.
 */
export function registerPromptSubmitHook(
  pluginId: string,
  handler: TypedHook<PromptSubmitHookSpec>["handler"],
  options?: { priority?: number; scope?: HookScope }
): () => void {
  return getTypedHookRegistry().register<PromptSubmitHookSpec>(
    "PromptSubmit",
    pluginId,
    handler,
    options
  );
}

/**
 * Register a Compaction hook.
 */
export function registerCompactionHook(
  pluginId: string,
  handler: TypedHook<CompactionHookSpec>["handler"],
  options?: { priority?: number; scope?: HookScope }
): () => void {
  return getTypedHookRegistry().register<CompactionHookSpec>(
    "Compaction",
    pluginId,
    handler,
    options
  );
}

/**
 * Trigger PreToolUse hooks.
 */
export async function triggerPreToolUse(
  toolName: string,
  args: Record<string, unknown>,
  sessionId?: string
): Promise<HookTriggerResult<PreToolUseHookSpec>> {
  return getTypedHookRegistry().trigger<PreToolUseHookSpec>("PreToolUse", {
    toolName,
    args,
    sessionId,
  });
}

/**
 * Trigger PostToolUse hooks.
 */
export async function triggerPostToolUse(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
  durationMs: number,
  sessionId?: string
): Promise<HookTriggerResult<PostToolUseHookSpec>> {
  return getTypedHookRegistry().trigger<PostToolUseHookSpec>("PostToolUse", {
    toolName,
    args,
    result,
    durationMs,
    sessionId,
  });
}

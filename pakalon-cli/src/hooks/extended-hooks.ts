/**
 * Extended Hook System — Additional hook types for comprehensive lifecycle coverage.
 *
 * Adds hook types from Claude Code and Pi:
 * - UserPromptSubmit: Before user prompt is processed
 * - PreSampling: Before LLM sampling
 * - PostSampling: After LLM sampling
 * - SubagentStart: Before subagent is spawned
 * - SubagentEnd: After subagent completes
 * - BeforeProviderRequest: Before API request to provider
 * - AfterProviderResponse: After API response from provider
 * - SavePoint: State checkpoint hooks
 * - Abort: Cleanup hooks on abort
 * - Settled: Final cleanup hooks
 * - QueueUpdate: Queue state change hooks
 * - ModelSelect: Model selection hooks
 * - ResourcesUpdate: Resource update hooks
 *
 * Port from Pi's AgentHarness event types.
 */

import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Extended Hook Event Types
// ─────────────────────────────────────────────────────────────────────────────

export type ExtendedHookEvent =
  | "UserPromptSubmit"
  | "PreSampling"
  | "PostSampling"
  | "SubagentStart"
  | "SubagentEnd"
  | "BeforeProviderRequest"
  | "AfterProviderResponse"
  | "SavePoint"
  | "Abort"
  | "Settled"
  | "QueueUpdate"
  | "ModelSelect"
  | "ResourcesUpdate"
  | "SystemPromptBuild"
  | "ContextTransform";

// ─────────────────────────────────────────────────────────────────────────────
// Hook Event Payloads
// ─────────────────────────────────────────────────────────────────────────────

export interface UserPromptSubmitPayload {
  /** User's prompt text */
  prompt: string;
  /** Session ID */
  sessionId?: string;
  /** Working directory */
  cwd?: string;
  /** Whether to allow the prompt */
  allow: boolean;
  /** Modified prompt (if transformed) */
  modifiedPrompt?: string;
}

export interface PreSamplingPayload {
  /** Messages to be sent to LLM */
  messages: unknown[];
  /** Model being used */
  model: string;
  /** System prompt */
  systemPrompt: string;
  /** Session ID */
  sessionId?: string;
  /** Whether to allow sampling */
  allow: boolean;
}

export interface PostSamplingPayload {
  /** LLM response */
  response: unknown;
  /** Model used */
  model: string;
  /** Token usage */
  usage?: { input: number; output: number };
  /** Duration in milliseconds */
  durationMs: number;
  /** Session ID */
  sessionId?: string;
}

export interface SubagentStartPayload {
  /** Subagent ID */
  agentId: string;
  /** Subagent type */
  agentType: string;
  /** Task description */
  description: string;
  /** Parent session ID */
  parentSessionId?: string;
  /** Whether to allow subagent creation */
  allow: boolean;
}

export interface SubagentEndPayload {
  /** Subagent ID */
  agentId: string;
  /** Subagent type */
  agentType: string;
  /** Whether subagent succeeded */
  success: boolean;
  /** Result summary */
  result?: string;
  /** Duration in milliseconds */
  durationMs: number;
}

export interface ProviderRequestPayload {
  /** Provider name */
  provider: string;
  /** Model */
  model: string;
  /** Request payload */
  payload: unknown;
  /** Session ID */
  sessionId?: string;
}

export interface ProviderResponsePayload {
  /** Provider name */
  provider: string;
  /** Model */
  model: string;
  /** Response payload */
  response: unknown;
  /** Duration in milliseconds */
  durationMs: number;
  /** HTTP status code */
  statusCode?: number;
  /** Session ID */
  sessionId?: string;
}

export interface SavePointPayload {
  /** Save point ID */
  savePointId: string;
  /** Session ID */
  sessionId: string;
  /** Messages at save point */
  messageCount: number;
  /** Token count */
  tokenCount: number;
}

export interface AbortPayload {
  /** Reason for abort */
  reason: string;
  /** Session ID */
  sessionId?: string;
  /** Whether cleanup is needed */
  needsCleanup: boolean;
}

export interface SettledPayload {
  /** Session ID */
  sessionId: string;
  /** Total messages */
  messageCount: number;
  /** Total tokens */
  tokenCount: number;
  /** Duration in milliseconds */
  durationMs: number;
}

export interface QueueUpdatePayload {
  /** Queue type */
  queueType: "steering" | "followUp" | "nextTurn";
  /** Queue action */
  action: "enqueue" | "dequeue" | "clear" | "rollback";
  /** Queue size */
  queueSize: number;
  /** Affected item ID */
  itemId?: string;
}

export interface ModelSelectPayload {
  /** Current model */
  currentModel: string;
  /** Proposed model */
  proposedModel: string;
  /** Whether to allow the change */
  allow: boolean;
  /** Session ID */
  sessionId?: string;
}

export interface ResourcesUpdatePayload {
  /** Resource type */
  resourceType: "mcp" | "tool" | "skill" | "agent";
  /** Resource action */
  action: "add" | "remove" | "update";
  /** Resource name */
  resourceName: string;
  /** Whether to allow the change */
  allow: boolean;
}

export interface SystemPromptBuildPayload {
  /** Base system prompt */
  basePrompt: string;
  /** Additional context */
  additionalContext: string[];
  /** Session ID */
  sessionId?: string;
  /** Modified prompt */
  modifiedPrompt?: string;
}

export interface ContextTransformPayload {
  /** Original messages */
  messages: unknown[];
  /** Transform type */
  transformType: "compact" | "prune" | "summarize";
  /** Session ID */
  sessionId?: string;
  /** Modified messages */
  modifiedMessages?: unknown[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Union Types
// ─────────────────────────────────────────────────────────────────────────────

export type ExtendedHookPayload =
  | UserPromptSubmitPayload
  | PreSamplingPayload
  | PostSamplingPayload
  | SubagentStartPayload
  | SubagentEndPayload
  | ProviderRequestPayload
  | ProviderResponsePayload
  | SavePointPayload
  | AbortPayload
  | SettledPayload
  | QueueUpdatePayload
  | ModelSelectPayload
  | ResourcesUpdatePayload
  | SystemPromptBuildPayload
  | ContextTransformPayload;

export interface ExtendedHookResult {
  /** Whether to proceed */
  proceed: boolean;
  /** Modified payload (if transformed) */
  modifiedPayload?: unknown;
  /** Warning messages */
  warnings?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Extended Hook Handler
// ─────────────────────────────────────────────────────────────────────────────

export type ExtendedHookHandler<T extends ExtendedHookPayload = ExtendedHookPayload> = (
  payload: T
) => Promise<ExtendedHookResult | void> | ExtendedHookResult | void;

interface ExtendedHookRegistration {
  id: string;
  name: string;
  event: ExtendedHookEvent;
  handler: ExtendedHookHandler;
  priority: number;
  enabled: boolean;
  description?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Extended Hook Manager
// ─────────────────────────────────────────────────────────────────────────────

export class ExtendedHookManager {
  private hooks: Map<ExtendedHookEvent, ExtendedHookRegistration[]> = new Map();
  private hookIdCounter = 0;

  /**
   * Register a hook for an extended event.
   */
  register<T extends ExtendedHookPayload>(
    event: ExtendedHookEvent,
    name: string,
    handler: ExtendedHookHandler<T>,
    options?: { priority?: number; description?: string }
  ): () => void {
    const registration: ExtendedHookRegistration = {
      id: `ext_${++this.hookIdCounter}_${Date.now()}`,
      name,
      event,
      handler: handler as ExtendedHookHandler,
      priority: options?.priority ?? 0,
      enabled: true,
      description: options?.description,
    };

    const hooks = this.hooks.get(event) ?? [];
    hooks.push(registration);
    hooks.sort((a, b) => b.priority - a.priority);
    this.hooks.set(event, hooks);

    logger.debug("[ExtendedHooks] Registered", { event, name, id: registration.id });
    return () => this.unregister(registration.id);
  }

  /**
   * Unregister a hook by ID.
   */
  unregister(id: string): boolean {
    for (const [event, hooks] of this.hooks) {
      const index = hooks.findIndex((h) => h.id === id);
      if (index !== -1) {
        hooks.splice(index, 1);
        logger.debug("[ExtendedHooks] Unregistered", { id });
        return true;
      }
    }
    return false;
  }

  /**
   * Execute hooks for an event.
   */
  async execute<T extends ExtendedHookPayload>(
    event: ExtendedHookEvent,
    payload: T
  ): Promise<ExtendedHookResult> {
    const hooks = this.hooks.get(event) ?? [];
    let proceed = true;
    const warnings: string[] = [];

    for (const registration of hooks) {
      if (!registration.enabled) continue;

      try {
        const result = await registration.handler(payload);
        if (result && typeof result === "object") {
          if (result.proceed === false) {
            proceed = false;
            logger.debug("[ExtendedHooks] Hook blocked execution", {
              event,
              hook: registration.name,
            });
          }
          if (result.warnings) {
            warnings.push(...result.warnings);
          }
        }
      } catch (error) {
        logger.error("[ExtendedHooks] Hook error", {
          event,
          hook: registration.name,
          error: String(error),
        });
        warnings.push(`Hook ${registration.name} error: ${error}`);
      }
    }

    return { proceed, warnings };
  }

  /**
   * Execute hooks and check if execution should proceed.
   */
  async shouldProceed<T extends ExtendedHookPayload>(
    event: ExtendedHookEvent,
    payload: T
  ): Promise<boolean> {
    const result = await this.execute(event, payload);
    return result.proceed;
  }

  /**
   * Enable/disable a hook.
   */
  toggle(id: string, enabled: boolean): boolean {
    for (const hooks of this.hooks.values()) {
      const hook = hooks.find((h) => h.id === id);
      if (hook) {
        hook.enabled = enabled;
        return true;
      }
    }
    return false;
  }

  /**
   * Get all hooks for an event.
   */
  getHooksForEvent(event: ExtendedHookEvent): ExtendedHookRegistration[] {
    return [...(this.hooks.get(event) ?? [])];
  }

  /**
   * Get all registered hooks.
   */
  getAllHooks(): ExtendedHookRegistration[] {
    const all: ExtendedHookRegistration[] = [];
    for (const hooks of this.hooks.values()) {
      all.push(...hooks);
    }
    return all;
  }

  /**
   * Clear all hooks.
   */
  clearAll(): void {
    this.hooks.clear();
    logger.debug("[ExtendedHooks] Cleared all hooks");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let managerInstance: ExtendedHookManager | null = null;

/**
 * Get the singleton extended hook manager.
 */
export function getExtendedHookManager(): ExtendedHookManager {
  if (!managerInstance) {
    managerInstance = new ExtendedHookManager();
  }
  return managerInstance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetExtendedHookManager(): void {
  managerInstance = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register a UserPromptSubmit hook.
 */
export function onUserPromptSubmit(
  name: string,
  handler: ExtendedHookHandler<UserPromptSubmitPayload>,
  priority?: number
): () => void {
  return getExtendedHookManager().register("UserPromptSubmit", name, handler, { priority });
}

/**
 * Register a PreSampling hook.
 */
export function onPreSampling(
  name: string,
  handler: ExtendedHookHandler<PreSamplingPayload>,
  priority?: number
): () => void {
  return getExtendedHookManager().register("PreSampling", name, handler, { priority });
}

/**
 * Register a PostSampling hook.
 */
export function onPostSampling(
  name: string,
  handler: ExtendedHookHandler<PostSamplingPayload>,
  priority?: number
): () => void {
  return getExtendedHookManager().register("PostSampling", name, handler, { priority });
}

/**
 * Register a SubagentStart hook.
 */
export function onSubagentStart(
  name: string,
  handler: ExtendedHookHandler<SubagentStartPayload>,
  priority?: number
): () => void {
  return getExtendedHookManager().register("SubagentStart", name, handler, { priority });
}

/**
 * Register a SubagentEnd hook.
 */
export function onSubagentEnd(
  name: string,
  handler: ExtendedHookHandler<SubagentEndPayload>,
  priority?: number
): () => void {
  return getExtendedHookManager().register("SubagentEnd", name, handler, { priority });
}

/**
 * Register a BeforeProviderRequest hook.
 */
export function onBeforeProviderRequest(
  name: string,
  handler: ExtendedHookHandler<ProviderRequestPayload>,
  priority?: number
): () => void {
  return getExtendedHookManager().register("BeforeProviderRequest", name, handler, { priority });
}

/**
 * Register an AfterProviderResponse hook.
 */
export function onAfterProviderResponse(
  name: string,
  handler: ExtendedHookHandler<ProviderResponsePayload>,
  priority?: number
): () => void {
  return getExtendedHookManager().register("AfterProviderResponse", name, handler, { priority });
}

/**
 * Register a SavePoint hook.
 */
export function onSavePoint(
  name: string,
  handler: ExtendedHookHandler<SavePointPayload>,
  priority?: number
): () => void {
  return getExtendedHookManager().register("SavePoint", name, handler, { priority });
}

/**
 * Register an Abort hook.
 */
export function onAbort(
  name: string,
  handler: ExtendedHookHandler<AbortPayload>,
  priority?: number
): () => void {
  return getExtendedHookManager().register("Abort", name, handler, { priority });
}

/**
 * Register a Settled hook.
 */
export function onSettled(
  name: string,
  handler: ExtendedHookHandler<SettledPayload>,
  priority?: number
): () => void {
  return getExtendedHookManager().register("Settled", name, handler, { priority });
}

/**
 * Register a QueueUpdate hook.
 */
export function onQueueUpdate(
  name: string,
  handler: ExtendedHookHandler<QueueUpdatePayload>,
  priority?: number
): () => void {
  return getExtendedHookManager().register("QueueUpdate", name, handler, { priority });
}

/**
 * Register a ModelSelect hook.
 */
export function onModelSelect(
  name: string,
  handler: ExtendedHookHandler<ModelSelectPayload>,
  priority?: number
): () => void {
  return getExtendedHookManager().register("ModelSelect", name, handler, { priority });
}

/**
 * Register a ResourcesUpdate hook.
 */
export function onResourcesUpdate(
  name: string,
  handler: ExtendedHookHandler<ResourcesUpdatePayload>,
  priority?: number
): () => void {
  return getExtendedHookManager().register("ResourcesUpdate", name, handler, { priority });
}

/**
 * Register a SystemPromptBuild hook.
 */
export function onSystemPromptBuild(
  name: string,
  handler: ExtendedHookHandler<SystemPromptBuildPayload>,
  priority?: number
): () => void {
  return getExtendedHookManager().register("SystemPromptBuild", name, handler, { priority });
}

/**
 * Register a ContextTransform hook.
 */
export function onContextTransform(
  name: string,
  handler: ExtendedHookHandler<ContextTransformPayload>,
  priority?: number
): () => void {
  return getExtendedHookManager().register("ContextTransform", name, handler, { priority });
}

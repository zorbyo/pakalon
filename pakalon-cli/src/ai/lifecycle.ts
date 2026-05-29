/**
 * Lifecycle Hooks Integration - bridges hooks.ts with session events.
 *
 * This module provides a unified lifecycle management layer that:
 * 1. Fires hooks from .pakalon/hooks.json (file-based hooks)
 * 2. Emits session events for observers
 *
 * Hook Flow:
 *   User Input -> SessionStart (first time)
 *   User Prompt -> UserPromptSubmit hook -> event
 *   Tool Call -> PreToolUse hook -> event -> Execute -> PostToolUse hook -> event
 *   Error -> ErrorOccurred hook -> event
 *   Session End -> SessionEnd hook -> event
 */
import {
  fireLifecycleHook,
  runSessionStartHook,
  runUserPromptSubmitHook,
  runPreToolUseHook,
  runPostToolUseHook,
  runStopHook,
  type LifecycleHookEvent,
  type HookDecision,
} from "@/ai/hooks.js";
import { getSessionEventBus } from "@/events/session-events.js";
import { WorktreeManager } from "@/ai/worktree.js";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LifecycleContext {
  sessionId: string;
  workingDirectory: string;
  userId?: string;
  /** Optional worktree manager for isolated agent workspace */
  worktreeManager?: WorktreeManager;
  /** Optional worktree options — if set, a worktree is created on session start */
  createWorktree?: boolean;
}

export interface ToolLifecycleContext {
  sessionId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  executionId: string;
}

export interface LifecycleDecision {
  allow: boolean;
  reason?: string;
  modifiedArgs?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Session Lifecycle
// ---------------------------------------------------------------------------

const activeSessions = new Map<string, LifecycleContext>();

/**
 * Start a session lifecycle (fires SessionStart hooks + event).
 * Optionally creates a git worktree for isolated agent workspace.
 */
export async function startSessionLifecycle(context: LifecycleContext): Promise<void> {
  activeSessions.set(context.sessionId, context);
  const bus = getSessionEventBus();

  bus.emit({
    type: "session.start",
    sessionId: context.sessionId,
    workingDirectory: context.workingDirectory,
    model: "default",
  });

  // Optionally create a worktree for isolated agent workspace
  if (context.createWorktree && context.worktreeManager) {
    try {
      await context.worktreeManager.initialize();
      const safeName = `session-${context.sessionId.slice(0, 8)}`;
      const worktree = await context.worktreeManager.create(safeName, {
        detached: true,
      });
      logger.info("[lifecycle] Worktree created for session", {
        sessionId: context.sessionId,
        path: worktree.path,
        branch: worktree.branch,
      });
    } catch (err) {
      logger.warn("[lifecycle] Failed to create worktree", {
        sessionId: context.sessionId,
        error: String(err),
      });
    }
  }

  try {
    await runSessionStartHook(context.workingDirectory, context.sessionId);
  } catch (err) {
    logger.warn("[lifecycle] SessionStart hook error", { error: String(err) });
  }

  logger.info("[lifecycle] Session started", { sessionId: context.sessionId });
}

/**
 * End a session lifecycle (fires SessionEnd hooks + event).
 */
export async function endSessionLifecycle(
  sessionId: string,
  reason: "user" | "error" | "timeout" | "compaction" = "user"
): Promise<void> {
  const bus = getSessionEventBus();

  bus.emit({
    type: "session.shutdown",
    sessionId,
    reason,
  });

  const ctx = activeSessions.get(sessionId);
  try {
    await fireLifecycleHook("SessionEnd", { cwd: ctx?.workingDirectory, sessionId }, ctx?.workingDirectory);
  } catch (err) {
    logger.warn("[lifecycle] SessionEnd hook error", { error: String(err) });
  }

  activeSessions.delete(sessionId);
  logger.info("[lifecycle] Session ended", { sessionId, reason });
}

// ---------------------------------------------------------------------------
// User Prompt Lifecycle
// ---------------------------------------------------------------------------

/**
 * Handle user prompt submission (fires UserPromptSubmit hook + event).
 */
export async function handleUserPrompt(
  sessionId: string,
  prompt: string,
  projectDir?: string
): Promise<{ prompt: string; blocked: boolean; reason?: string }> {
  const bus = getSessionEventBus();

  bus.emit({
    type: "user.message",
    messageId: crypto.randomUUID(),
    content: prompt,
    sessionId,
  });

  try {
    const result = await runUserPromptSubmitHook(prompt, projectDir, sessionId);
    if (result.blocked) {
      return {
        prompt,
        blocked: true,
        reason: result.reason ?? "Prompt blocked by hook",
      };
    }
  } catch (err) {
    logger.warn("[lifecycle] UserPromptSubmit hook error", { error: String(err) });
  }

  return { prompt, blocked: false };
}

// ---------------------------------------------------------------------------
// Tool Lifecycle
// ---------------------------------------------------------------------------

/**
 * Handle pre-tool execution (fires PreToolUse hook + event).
 */
export async function handlePreToolUse(
  context: ToolLifecycleContext,
  projectDir?: string
): Promise<LifecycleDecision> {
  const bus = getSessionEventBus();

  bus.emit({
    type: "tool.execution_start",
    toolName: context.toolName,
    toolArgs: context.toolArgs,
    executionId: context.executionId,
    sessionId: context.sessionId,
  });

  try {
    const result = await runPreToolUseHook(
      context.toolName,
      context.toolArgs,
      projectDir,
      context.sessionId
    );

    if (result.blocked) {
      return {
        allow: false,
        reason: result.reason ?? "Tool execution denied by hook",
      };
    }

    if (result.decision?.updatedInput) {
      return {
        allow: true,
        modifiedArgs: result.decision.updatedInput,
      };
    }
  } catch (err) {
    logger.warn("[lifecycle] PreToolUse hook error", { error: String(err) });
  }

  return { allow: true };
}

/**
 * Handle post-tool execution (fires PostToolUse hook + event).
 */
export async function handlePostToolUse(
  context: ToolLifecycleContext,
  result: unknown,
  duration: number,
  success: boolean,
  projectDir?: string
): Promise<void> {
  const bus = getSessionEventBus();

  if (success) {
    bus.emit({
      type: "tool.execution_complete",
      toolName: context.toolName,
      executionId: context.executionId,
      duration,
      success,
      sessionId: context.sessionId,
    });
  } else {
    bus.emit({
      type: "tool.execution_error",
      toolName: context.toolName,
      executionId: context.executionId,
      error: typeof result === "object" && result !== null && "error" in result
        ? String((result as Record<string, unknown>).error)
        : "Tool execution failed",
      sessionId: context.sessionId,
    });
  }

  try {
    await runPostToolUseHook(context.toolName, context.toolArgs, projectDir, context.sessionId);
  } catch (err) {
    logger.warn("[lifecycle] PostToolUse hook error", { error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Assistant Turn Lifecycle
// ---------------------------------------------------------------------------

export function startAssistantTurn(sessionId?: string): string {
  const turnId = crypto.randomUUID();
  const bus = getSessionEventBus();

  bus.emit({
    type: "assistant.turn_start",
    turnId,
    sessionId,
  });

  return turnId;
}

export function endAssistantTurn(
  turnId: string,
  duration: number,
  tokenCount: number,
  sessionId?: string
): void {
  const bus = getSessionEventBus();

  bus.emit({
    type: "assistant.turn_end",
    turnId,
    duration,
    tokenCount,
    sessionId,
  });
}

export function emitAssistantMessage(
  messageId: string,
  content: string,
  sessionId?: string,
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>
): void {
  const bus = getSessionEventBus();

  bus.emit({
    type: "assistant.message",
    messageId,
    content,
    toolCalls,
    sessionId,
  });
}

// ---------------------------------------------------------------------------
// Setup Lifecycle Hook
// ---------------------------------------------------------------------------

/**
 * Fire Setup hook — called when the agent is first initialized.
 */
export async function fireSetupHook(context: LifecycleContext): Promise<void> {
  try {
    await fireLifecycleHook("Setup", {
      sessionId: context.sessionId,
      cwd: context.workingDirectory,
      filePath: context.workingDirectory,
    }, context.workingDirectory);
  } catch (err) {
    logger.warn("[lifecycle] Setup hook error", { error: String(err) });
  }

  const bus = getSessionEventBus();
  bus.emit({
    type: "session.start",
    sessionId: context.sessionId,
    workingDirectory: context.workingDirectory,
    model: "default",
  });
}

// ---------------------------------------------------------------------------
// Subagent Lifecycle Hooks
// ---------------------------------------------------------------------------

export interface SubagentContext {
  sessionId: string;
  agentId: string;
  agentName: string;
  task: string;
}

/**
 * Fire SubagentStart hook — called when a subagent is spawned.
 */
export async function fireSubagentStartHook(context: SubagentContext): Promise<void> {
  const bus = getSessionEventBus();
  bus.emit({
    type: "extension.loaded",
    extensionName: context.agentName,
    tools: [],
    hooks: [],
  });

  try {
    await fireLifecycleHook("SubagentStart", {
      sessionId: context.sessionId,
      agentId: context.agentId,
      agentName: context.agentName,
      content: context.task,
      cwd: process.cwd(),
    }, process.cwd());
  } catch (err) {
    logger.warn("[lifecycle] SubagentStart hook error", { error: String(err) });
  }
}

/**
 * Fire SubagentStop hook — called when a subagent completes/fails.
 */
export async function fireSubagentStopHook(
  context: SubagentContext,
  success: boolean,
  output?: string,
): Promise<void> {
  const bus = getSessionEventBus();
  bus.emit({
    type: "extension.unloaded",
    extensionName: context.agentName,
    reason: success ? "manual" : "error",
  });

  try {
    await fireLifecycleHook("SubagentStop", {
      sessionId: context.sessionId,
      agentId: context.agentId,
      agentName: context.agentName,
      success,
      content: output,
      cwd: process.cwd(),
    }, process.cwd());
  } catch (err) {
    logger.warn("[lifecycle] SubagentStop hook error", { error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Compact Lifecycle Hooks
// ---------------------------------------------------------------------------

export interface CompactContext {
  sessionId: string;
  originalCount: number;
  newCount: number;
  tokensSaved: number;
}

/**
 * Fire PreCompact hook — called before context compaction.
 */
export async function firePreCompactHook(context: CompactContext): Promise<void> {
  try {
    await fireLifecycleHook("PreCompact", {
      sessionId: context.sessionId,
      content: String(context.originalCount),
      cwd: process.cwd(),
    }, process.cwd());
  } catch (err) {
    logger.warn("[lifecycle] PreCompact hook error", { error: String(err) });
  }
}

/**
 * Fire PostCompact hook — called after context compaction.
 */
export async function firePostCompactHook(context: CompactContext): Promise<void> {
  const bus = getSessionEventBus();
  bus.emit({
    type: "session.compaction",
    originalMessageCount: context.originalCount,
    newMessageCount: context.newCount,
    tokensSaved: context.tokensSaved,
  });

  try {
    await fireLifecycleHook("PostCompact", {
      sessionId: context.sessionId,
      content: JSON.stringify({ originalCount: context.originalCount, newCount: context.newCount, tokensSaved: context.tokensSaved }),
      cwd: process.cwd(),
    }, process.cwd());
  } catch (err) {
    logger.warn("[lifecycle] PostCompact hook error", { error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Permission Lifecycle Hooks
// ---------------------------------------------------------------------------

export interface PermissionContext {
  sessionId: string;
  requestId: string;
  toolName: string;
  description: string;
  riskLevel: "low" | "medium" | "high" | "critical";
}

/**
 * Fire PermissionRequest hook — called when a tool needs user approval.
 */
export async function firePermissionRequestHook(context: PermissionContext): Promise<boolean> {
  const bus = getSessionEventBus();
  bus.emit({
    type: "permission.requested",
    requestId: context.requestId,
    toolName: context.toolName,
    description: context.description,
    riskLevel: context.riskLevel,
  });

  try {
    const result = await fireLifecycleHook("PermissionRequest", {
      sessionId: context.sessionId,
      toolName: context.toolName,
      content: context.description,
      cwd: process.cwd(),
    }, process.cwd());

    // If hook denied, propagate
    if (result?.decision?.action === "deny") {
      bus.emit({
        type: "permission.decided",
        requestId: context.requestId,
        toolName: context.toolName,
        allowed: false,
        mode: "deny",
      });
      return false;
    }

    return true;
  } catch (err) {
    logger.warn("[lifecycle] PermissionRequest hook error", { error: String(err) });
    return true; // Default to allow on hook error
  }
}

/**
 * Fire PermissionDenied hook — called when a tool request is denied.
 */
export async function firePermissionDeniedHook(context: PermissionContext, reason?: string): Promise<void> {
  const bus = getSessionEventBus();
  bus.emit({
    type: "permission.decided",
    requestId: context.requestId,
    toolName: context.toolName,
    allowed: false,
    mode: "deny",
  });

  try {
    await fireLifecycleHook("PermissionDenied", {
      sessionId: context.sessionId,
      toolName: context.toolName,
      content: reason ?? "Permission denied by user",
      cwd: process.cwd(),
    }, process.cwd());
  } catch (err) {
    logger.warn("[lifecycle] PermissionDenied hook error", { error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Stop Lifecycle Hooks
// ---------------------------------------------------------------------------

export interface StopContext {
  sessionId: string;
  reason: "user" | "error" | "timeout";
  messageCount: number;
}

/**
 * Fire Stop hook — called when the session is stopping.
 * Returns whether the stop was acknowledged (hook can veto).
 */
export async function fireStopHook(context: StopContext): Promise<boolean> {
  try {
    const result = await fireLifecycleHook("Stop", {
      sessionId: context.sessionId,
      content: context.reason,
      cwd: process.cwd(),
    }, process.cwd());

    // If hook returns continue=false, block the stop
    if (result?.decision?.continue === false) {
      return false;
    }
  } catch (err) {
    logger.warn("[lifecycle] Stop hook error", { error: String(err) });
  }

  const bus = getSessionEventBus();
  bus.emit({
    type: "session.shutdown",
    sessionId: context.sessionId,
    reason: context.reason === "timeout" ? "timeout" : context.reason === "error" ? "error" : "user",
  });

  return true;
}

/**
 * Fire StopFailure hook — called when a stop operation fails.
 */
export async function fireStopFailureHook(sessionId: string, error: string): Promise<void> {
  const bus = getSessionEventBus();
  bus.emit({
    type: "session.error",
    sessionId,
    error,
    recoverable: false,
  });

  try {
    await fireLifecycleHook("StopFailure", {
      sessionId,
      content: error,
      cwd: process.cwd(),
    }, process.cwd());
  } catch (err) {
    logger.warn("[lifecycle] StopFailure hook error", { error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Worktree Lifecycle Hooks
// ---------------------------------------------------------------------------

export interface WorktreeContext {
  sessionId: string;
  worktreePath: string;
  branch?: string;
}

/**
 * Fire WorktreeCreate hook — called when a worktree is created.
 */
export async function fireWorktreeCreateHook(context: WorktreeContext): Promise<void> {
  try {
    await fireLifecycleHook("WorktreeCreate", {
      sessionId: context.sessionId,
      worktreePath: context.worktreePath,
      content: context.branch,
      cwd: process.cwd(),
    }, process.cwd());
  } catch (err) {
    logger.warn("[lifecycle] WorktreeCreate hook error", { error: String(err) });
  }
}

/**
 * Fire WorktreeRemove hook — called when a worktree is removed.
 */
export async function fireWorktreeRemoveHook(context: WorktreeContext): Promise<void> {
  try {
    await fireLifecycleHook("WorktreeRemove", {
      sessionId: context.sessionId,
      worktreePath: context.worktreePath,
      content: context.branch,
      cwd: process.cwd(),
    }, process.cwd());
  } catch (err) {
    logger.warn("[lifecycle] WorktreeRemove hook error", { error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Config Change Hook
// ---------------------------------------------------------------------------

export interface ConfigChangeContext {
  sessionId: string;
  key: string;
  oldValue?: unknown;
  newValue: unknown;
}

/**
 * Fire ConfigChange hook — called when configuration changes.
 */
export async function fireConfigChangeHook(context: ConfigChangeContext): Promise<void> {
  try {
    await fireLifecycleHook("ConfigChange", {
      sessionId: context.sessionId,
      content: JSON.stringify({ key: context.key, oldValue: context.oldValue, newValue: context.newValue }),
      cwd: process.cwd(),
    }, process.cwd());
  } catch (err) {
    logger.warn("[lifecycle] ConfigChange hook error", { error: String(err) });
  }
}

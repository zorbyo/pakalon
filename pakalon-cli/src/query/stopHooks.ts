/**
 * Query Stop Hooks
 * Handles stopping and cleanup of query execution
 */
import type { QueryPhase } from './QueryEngine.js';
import logger from '@/utils/logger.js';

export interface StopHookContext {
  reason: StopReason;
  phase: QueryPhase;
  turn: number;
  toolCallCount: number;
  duration: number;
  abortSignal?: AbortSignal;
}

export type StopReason =
  | 'user_request'
  | 'max_turns'
  | 'max_tokens'
  | 'tool_limit'
  | 'error'
  | 'timeout'
  | 'abort';

export type StopHook = (context: StopHookContext) => Promise<void> | void;

const stopHooks: StopHook[] = [];
const preStopHooks: StopHook[] = [];

export function registerStopHook(hook: StopHook): () => void {
  stopHooks.push(hook);
  logger.debug('[StopHooks] Registered stop hook');
  return () => unregisterStopHook(hook);
}

export function unregisterStopHook(hook: StopHook): void {
  const index = stopHooks.indexOf(hook);
  if (index !== -1) {
    stopHooks.splice(index, 1);
    logger.debug('[StopHooks] Unregistered stop hook');
  }
}

export function registerPreStopHook(hook: StopHook): () => void {
  preStopHooks.push(hook);
  logger.debug('[StopHooks] Registered pre-stop hook');
  return () => unregisterPreStopHook(hook);
}

export function unregisterPreStopHook(hook: StopHook): void {
  const index = preStopHooks.indexOf(hook);
  if (index !== -1) {
    preStopHooks.splice(index, 1);
    logger.debug('[StopHooks] Unregistered pre-stop hook');
  }
}

export async function executeStopHooks(context: StopHookContext): Promise<void> {
  logger.info(`[StopHooks] Executing ${stopHooks.length} stop hooks, reason: ${context.reason}`);

  for (const hook of preStopHooks) {
    try {
      await hook(context);
    } catch (error) {
      logger.error(`[StopHooks] Pre-stop hook error: ${error}`);
    }
  }

  for (const hook of stopHooks) {
    try {
      await hook(context);
    } catch (error) {
      logger.error(`[StopHooks] Stop hook error: ${error}`);
    }
  }
}

export async function executeStopHooksSync(context: StopHookContext): Promise<void> {
  logger.info(`[StopHooks] Executing stop hooks synchronously, reason: ${context.reason}`);

  for (const hook of [...preStopHooks, ...stopHooks]) {
    try {
      const result = hook(context);
      if (result instanceof Promise) {
        await result;
      }
    } catch (error) {
      logger.error(`[StopHooks] Stop hook error: ${error}`);
    }
  }
}

export function clearStopHooks(): void {
  stopHooks.length = 0;
  preStopHooks.length = 0;
  logger.debug('[StopHooks] Cleared all stop hooks');
}

export function getStopHookCount(): number {
  return stopHooks.length;
}

export function getPreStopHookCount(): number {
  return preStopHooks.length;
}

export function createStopContext(
  reason: StopReason,
  phase: QueryPhase,
  turn: number,
  toolCallCount: number,
  duration: number,
  abortSignal?: AbortSignal,
): StopHookContext {
  return {
    reason,
    phase,
    turn,
    toolCallCount,
    duration,
    abortSignal,
  };
}

export { StopHook, StopHookContext, StopReason };
/**
 * Stop Hook
 * Executes when a session or agent is stopped
 */
import logger from '@/utils/logger.js';

export interface StopHookContext {
  reason: 'user_request' | 'max_turns' | 'max_tokens' | 'timeout' | 'error' | 'abort';
  agentId?: string;
  agentType?: string;
  turnCount?: number;
  duration?: number;
  timestamp: number;
}

export interface StopHookResult {
  cleanup?: boolean;
  message?: string;
}

export type StopHook = (
  context: StopHookContext
) => Promise<StopHookResult | void>;

interface HookRegistration {
  id: string;
  name: string;
  handler: StopHook;
  enabled: boolean;
  priority: number;
}

const stopHooks: HookRegistration[] = [];
let hookIdCounter = 0;

function generateHookId(): string {
  return `stop_${++hookIdCounter}_${Date.now()}`;
}

export function registerStopHook(
  name: string,
  handler: StopHook,
  priority = 0,
): () => void {
  const registration: HookRegistration = {
    id: generateHookId(),
    name,
    handler,
    enabled: true,
    priority,
  };
  stopHooks.push(registration);
  stopHooks.sort((a, b) => b.priority - a.priority);
  logger.debug(`[StopHook] Registered hook: ${name}`);
  return () => unregisterHook(registration.id);
}

function unregisterHook(id: string): void {
  const index = stopHooks.findIndex(h => h.id === id);
  if (index !== -1) {
    stopHooks.splice(index, 1);
    logger.debug(`[StopHook] Unregistered hook: ${id}`);
  }
}

export async function executeStopHooks(
  context: StopHookContext,
): Promise<void> {
  for (const registration of stopHooks) {
    if (!registration.enabled) continue;

    try {
      await registration.handler(context);
    } catch (err) {
      logger.error(`[StopHook] Hook '${registration.name}' error: ${err}`);
    }
  }
}

export function clearAllStopHooks(): void {
  stopHooks.length = 0;
  logger.debug('[StopHook] Cleared all hooks');
}

export function getStopHookCount(): number {
  return stopHooks.filter(h => h.enabled).length;
}

export type { StopHookContext, StopHookResult, HookRegistration };
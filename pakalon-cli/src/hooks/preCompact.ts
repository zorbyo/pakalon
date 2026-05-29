/**
 * PreCompact Hook
 * Executes before context compaction
 */
import logger from '@/utils/logger.js';
import type { CoreMessage } from 'ai';

export interface PreCompactContext {
  messages: CoreMessage[];
  currentLength: number;
  maxLength: number;
  timestamp: number;
}

export interface PreCompactResult {
  shouldCompact: boolean;
  modifiedMessages?: CoreMessage[];
  reason?: string;
}

export type PreCompactHook = (
  context: PreCompactContext
) => Promise<PreCompactResult | boolean | void>;

interface HookRegistration {
  id: string;
  name: string;
  handler: PreCompactHook;
  enabled: boolean;
  priority: number;
}

const preCompactHooks: HookRegistration[] = [];
let hookIdCounter = 0;

function generateHookId(): string {
  return `precompact_${++hookIdCounter}_${Date.now()}`;
}

export function registerPreCompactHook(
  name: string,
  handler: PreCompactHook,
  priority = 0,
): () => void {
  const registration: HookRegistration = {
    id: generateHookId(),
    name,
    handler,
    enabled: true,
    priority,
  };
  preCompactHooks.push(registration);
  preCompactHooks.sort((a, b) => b.priority - a.priority);
  logger.debug(`[PreCompact] Registered hook: ${name}`);
  return () => unregisterHook(registration.id);
}

function unregisterHook(id: string): void {
  const index = preCompactHooks.findIndex(h => h.id === id);
  if (index !== -1) {
    preCompactHooks.splice(index, 1);
    logger.debug(`[PreCompact] Unregistered hook: ${id}`);
  }
}

export async function executePreCompactHooks(
  context: PreCompactContext,
): Promise<PreCompactResult> {
  let shouldCompact = true;
  let modifiedMessages: CoreMessage[] | undefined;

  for (const registration of preCompactHooks) {
    if (!registration.enabled) continue;

    try {
      const result = await registration.handler(context);

      if (result === false) {
        shouldCompact = false;
        break;
      }

      if (result && typeof result === 'object') {
        const hookResult = result as PreCompactResult;
        if (hookResult.shouldCompact === false) {
          shouldCompact = false;
          break;
        }
        if (hookResult.modifiedMessages) {
          modifiedMessages = hookResult.modifiedMessages;
        }
      }
    } catch (err) {
      logger.error(`[PreCompact] Hook '${registration.name}' error: ${err}`);
    }
  }

  return { shouldCompact, modifiedMessages };
}

export function clearAllPreCompactHooks(): void {
  preCompactHooks.length = 0;
  logger.debug('[PreCompact] Cleared all hooks');
}

export type { PreCompactContext, PreCompactResult, HookRegistration };
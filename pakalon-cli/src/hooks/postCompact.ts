/**
 * PostCompact Hook
 * Executes after context compaction
 */
import logger from '@/utils/logger.js';
import type { CoreMessage } from 'ai';

export interface PostCompactContext {
  originalMessages: CoreMessage[];
  compactedMessages: CoreMessage[];
  originalCount: number;
  compactedCount: number;
  removedCount: number;
  timestamp: number;
}

export interface PostCompactResult {
  modifiedCompactedMessages?: CoreMessage[];
  shouldNotify?: boolean;
}

export type PostCompactHook = (
  context: PostCompactContext
) => Promise<PostCompactResult | void>;

interface HookRegistration {
  id: string;
  name: string;
  handler: PostCompactHook;
  enabled: boolean;
  priority: number;
}

const postCompactHooks: HookRegistration[] = [];
let hookIdCounter = 0;

function generateHookId(): string {
  return `postcompact_${++hookIdCounter}_${Date.now()}`;
}

export function registerPostCompactHook(
  name: string,
  handler: PostCompactHook,
  priority = 0,
): () => void {
  const registration: HookRegistration = {
    id: generateHookId(),
    name,
    handler,
    enabled: true,
    priority,
  };
  postCompactHooks.push(registration);
  postCompactHooks.sort((a, b) => b.priority - a.priority);
  logger.debug(`[PostCompact] Registered hook: ${name}`);
  return () => unregisterHook(registration.id);
}

function unregisterHook(id: string): void {
  const index = postCompactHooks.findIndex(h => h.id === id);
  if (index !== -1) {
    postCompactHooks.splice(index, 1);
    logger.debug(`[PostCompact] Unregistered hook: ${id}`);
  }
}

export async function executePostCompactHooks(
  context: PostCompactContext,
): Promise<PostCompactResult> {
  let modifiedMessages: CoreMessage[] | undefined;

  for (const registration of postCompactHooks) {
    if (!registration.enabled) continue;

    try {
      const result = await registration.handler(context);

      if (result && typeof result === 'object') {
        const hookResult = result as PostCompactResult;
        if (hookResult.modifiedCompactedMessages) {
          modifiedMessages = hookResult.modifiedCompactedMessages;
        }
      }
    } catch (err) {
      logger.error(`[PostCompact] Hook '${registration.name}' error: ${err}`);
    }
  }

  return { modifiedCompactedMessages: modifiedMessages };
}

export function clearAllPostCompactHooks(): void {
  postCompactHooks.length = 0;
  logger.debug('[PostCompact] Cleared all hooks');
}

export type { PostCompactContext, PostCompactResult, HookRegistration };
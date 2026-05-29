/**
 * PostToolUse Hook
 * Executes after a tool is used
 */
import logger from '@/utils/logger.js';

export interface PostToolUseContext {
  toolName: string;
  args: Record<string, any>;
  result: any;
  toolUseId: string;
  duration: number;
  success: boolean;
  timestamp: number;
}

export interface PostToolUseResult {
  modifiedResult?: any;
  error?: string;
  message?: string;
}

export type PostToolUseHook = (
  context: PostToolUseContext,
  result: any
) => Promise<PostToolUseResult | void>;

interface HookRegistration {
  id: string;
  name: string;
  handler: PostToolUseHook;
  enabled: boolean;
  priority: number;
}

const postToolUseHooks: HookRegistration[] = [];
let hookIdCounter = 0;

function generateHookId(): string {
  return `posttooluse_${++hookIdCounter}_${Date.now()}`;
}

export function registerPostToolUseHook(
  name: string,
  handler: PostToolUseHook,
  priority = 0,
): () => void {
  const registration: HookRegistration = {
    id: generateHookId(),
    name,
    handler,
    enabled: true,
    priority,
  };
  postToolUseHooks.push(registration);
  postToolUseHooks.sort((a, b) => b.priority - a.priority);
  logger.debug(`[PostToolUse] Registered hook: ${name}`);
  return () => unregisterHook(registration.id);
}

function unregisterHook(id: string): void {
  const index = postToolUseHooks.findIndex(h => h.id === id);
  if (index !== -1) {
    postToolUseHooks.splice(index, 1);
    logger.debug(`[PostToolUse] Unregistered hook: ${id}`);
  }
}

export async function executePostToolUseHooks(
  context: PostToolUseContext,
  originalResult: any,
): Promise<{ modifiedResult?: any }> {
  let modifiedResult: any = undefined;

  for (const registration of postToolUseHooks) {
    if (!registration.enabled) continue;

    try {
      const result = await registration.handler(context, modifiedResult ?? originalResult);

      if (result && typeof result === 'object') {
        const hookResult = result as PostToolUseResult;
        if (hookResult.modifiedResult !== undefined) {
          modifiedResult = hookResult.modifiedResult;
        }
      }
    } catch (err) {
      logger.error(`[PostToolUse] Hook '${registration.name}' error: ${err}`);
    }
  }

  return { modifiedResult };
}

export function clearAllPostToolUseHooks(): void {
  postToolUseHooks.length = 0;
  logger.debug('[PostToolUse] Cleared all hooks');
}

export function getPostToolUseHookCount(): number {
  return postToolUseHooks.filter(h => h.enabled).length;
}

export type { PostToolUseContext, PostToolUseResult, HookRegistration };
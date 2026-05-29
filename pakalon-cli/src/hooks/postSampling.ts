/**
 * PostSampling Hook
 * Executes after LLM sampling (response generation)
 */
import logger from '@/utils/logger.js';

export interface PostSamplingContext {
  response: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: 'stop' | 'length' | 'content_filter' | 'tool_use' | 'error';
  agentId?: string;
  timestamp: number;
}

export interface PostSamplingResult {
  modifiedResponse?: string;
  shouldBlock?: boolean;
  blockReason?: string;
}

export type PostSamplingHook = (
  context: PostSamplingContext
) => Promise<PostSamplingResult | void>;

interface HookRegistration {
  id: string;
  name: string;
  handler: PostSamplingHook;
  enabled: boolean;
  priority: number;
}

const postSamplingHooks: HookRegistration[] = [];
let hookIdCounter = 0;

function generateHookId(): string {
  return `postsampling_${++hookIdCounter}_${Date.now()}`;
}

export function registerPostSamplingHook(
  name: string,
  handler: PostSamplingHook,
  priority = 0,
): () => void {
  const registration: HookRegistration = {
    id: generateHookId(),
    name,
    handler,
    enabled: true,
    priority,
  };
  postSamplingHooks.push(registration);
  postSamplingHooks.sort((a, b) => b.priority - a.priority);
  logger.debug(`[PostSampling] Registered hook: ${name}`);
  return () => unregisterHook(registration.id);
}

function unregisterHook(id: string): void {
  const index = postSamplingHooks.findIndex(h => h.id === id);
  if (index !== -1) {
    postSamplingHooks.splice(index, 1);
    logger.debug(`[PostSampling] Unregistered hook: ${id}`);
  }
}

export async function executePostSamplingHooks(
  context: PostSamplingContext,
): Promise<PostSamplingResult> {
  let modifiedResponse: string | undefined;
  let shouldBlock = false;
  let blockReason: string | undefined;

  for (const registration of postSamplingHooks) {
    if (!registration.enabled) continue;

    try {
      const result = await registration.handler(context);

      if (result && typeof result === 'object') {
        const hookResult = result as PostSamplingResult;
        if (hookResult.modifiedResponse) {
          modifiedResponse = hookResult.modifiedResponse;
        }
        if (hookResult.shouldBlock) {
          shouldBlock = true;
          blockReason = hookResult.blockReason;
        }
      }
    } catch (err) {
      logger.error(`[PostSampling] Hook '${registration.name}' error: ${err}`);
    }
  }

  return { modifiedResponse, shouldBlock, blockReason };
}

export function clearAllPostSamplingHooks(): void {
  postSamplingHooks.length = 0;
  logger.debug('[PostSampling] Cleared all hooks');
}

export function getPostSamplingHookCount(): number {
  return postSamplingHooks.filter(h => h.enabled).length;
}

export type { PostSamplingContext, PostSamplingResult, HookRegistration };
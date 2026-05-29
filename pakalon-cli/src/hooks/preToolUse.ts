/**
 * PreToolUse Hook
 * Executes before a tool is used
 */
import type { Tools, ToolUseContext } from '@/ai/tool-registry';
import logger from '@/utils/logger.js';

export interface PreToolUseContext {
  toolName: string;
  args: Record<string, any>;
  toolUseId: string;
  toolUseContext?: ToolUseContext;
  timestamp: number;
}

export interface PreToolUseResult {
  allowed: boolean;
  modifiedArgs?: Record<string, any>;
  error?: string;
  message?: string;
}

export type PreToolUseHook = (
  context: PreToolUseContext
) => Promise<PreToolUseResult | boolean | void>;

interface HookRegistration {
  id: string;
  name: string;
  handler: PreToolUseHook;
  enabled: boolean;
  priority: number;
}

const preToolUseHooks: HookRegistration[] = [];
let hookIdCounter = 0;

function generateHookId(): string {
  return `pretooluse_${++hookIdCounter}_${Date.now()}`;
}

export function registerPreToolUseHook(
  name: string,
  handler: PreToolUseHook,
  priority = 0,
): () => void {
  const registration: HookRegistration = {
    id: generateHookId(),
    name,
    handler,
    enabled: true,
    priority,
  };
  preToolUseHooks.push(registration);
  preToolUseHooks.sort((a, b) => b.priority - a.priority);
  logger.debug(`[PreToolUse] Registered hook: ${name}`);
  return () => unregisterHook(registration.id);
}

function unregisterHook(id: string): void {
  const index = preToolUseHooks.findIndex(h => h.id === id);
  if (index !== -1) {
    preToolUseHooks.splice(index, 1);
    logger.debug(`[PreToolUse] Unregistered hook: ${id}`);
  }
}

export async function executePreToolUseHooks(
  context: PreToolUseContext,
): Promise<PreToolUseResult> {
  let allowed = true;
  let modifiedArgs: Record<string, any> | undefined;
  let error: string | undefined;

  for (const registration of preToolUseHooks) {
    if (!registration.enabled) continue;

    try {
      const result = await registration.handler(context);

      if (result === false) {
        allowed = false;
        error = `Hook '${registration.name}' denied execution`;
        break;
      }

      if (result && typeof result === 'object') {
        const hookResult = result as PreToolUseResult;
        if (hookResult.allowed === false) {
          allowed = false;
          error = hookResult.error || `Hook '${registration.name}' denied execution`;
          break;
        }
        if (hookResult.modifiedArgs) {
          modifiedArgs = hookResult.modifiedArgs;
        }
      }
    } catch (err) {
      logger.error(`[PreToolUse] Hook '${registration.name}' error: ${err}`);
    }
  }

  return { allowed, modifiedArgs, error };
}

export function enablePreToolUseHook(name: string): void {
  const hook = preToolUseHooks.find(h => h.name === name);
  if (hook) {
    hook.enabled = true;
    logger.debug(`[PreToolUse] Enabled hook: ${name}`);
  }
}

export function disablePreToolUseHook(name: string): void {
  const hook = preToolUseHooks.find(h => h.name === name);
  if (hook) {
    hook.enabled = false;
    logger.debug(`[PreToolUse] Disabled hook: ${name}`);
  }
}

export function clearAllPreToolUseHooks(): void {
  preToolUseHooks.length = 0;
  logger.debug('[PreToolUse] Cleared all hooks');
}

export function getPreToolUseHookCount(): number {
  return preToolUseHooks.filter(h => h.enabled).length;
}

export function listPreToolUseHooks(): Array<{ name: string; enabled: boolean; priority: number }> {
  return preToolUseHooks.map(h => ({
    name: h.name,
    enabled: h.enabled,
    priority: h.priority,
  }));
}

export type { PreToolUseContext, PreToolUseResult, HookRegistration };
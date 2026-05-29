/**
 * Hook Helpers
 * Utility functions for hook management
 */
import logger from '@/utils/logger.js';

export interface HookContext {
  agentId?: string;
  agentType?: string;
  messages?: any[];
  toolName?: string;
  toolArgs?: Record<string, any>;
  result?: any;
  error?: string;
  signal?: AbortSignal;
}

export interface HookResult {
  allowed?: boolean;
  modifiedContent?: any;
  error?: string;
  additionalContexts?: string[];
}

export type GenericHook = (context: HookContext) => Promise<HookResult | void>;

interface HookManager {
  hooks: Map<string, GenericHook>;
  enabled: Set<string>;
}

const hookManagers: Map<string, HookManager> = new Map();

export function getHookManager(name: string): HookManager {
  if (!hookManagers.has(name)) {
    hookManagers.set(name, {
      hooks: new Map(),
      enabled: new Set(),
    });
  }
  return hookManagers.get(name)!;
}

export function registerHook(
  managerName: string,
  hookName: string,
  handler: GenericHook,
): () => void {
  const manager = getHookManager(managerName);
  manager.hooks.set(hookName, handler);
  manager.enabled.add(hookName);
  logger.debug(`[HookHelpers] Registered ${managerName}/${hookName}`);
  return () => unregisterHook(managerName, hookName);
}

export function unregisterHook(managerName: string, hookName: string): void {
  const manager = hookManagers.get(managerName);
  if (manager) {
    manager.hooks.delete(hookName);
    manager.enabled.delete(hookName);
    logger.debug(`[HookHelpers] Unregistered ${managerName}/${hookName}`);
  }
}

export async function executeHook(
  managerName: string,
  hookName: string,
  context: HookContext,
): Promise<HookResult | undefined> {
  const manager = hookManagers.get(managerName);
  if (!manager) return undefined;

  const hook = manager.hooks.get(hookName);
  if (!hook || !manager.enabled.has(hookName)) return undefined;

  try {
    return await hook(context);
  } catch (err) {
    logger.error(`[HookHelpers] ${managerName}/${hookName} error: ${err}`);
    return { error: String(err) };
  }
}

export async function executeHooks(
  managerName: string,
  context: HookContext,
): Promise<{ results: Map<string, HookResult>; combined: HookResult }> {
  const manager = hookManagers.get(managerName);
  const results = new Map<string, HookResult>();

  if (!manager) {
    return { results, combined: {} };
  }

  for (const [name, hook] of manager.hooks) {
    if (!manager.enabled.has(name)) continue;

    try {
      const result = await hook(context);
      if (result) {
        results.set(name, result);
      }
    } catch (err) {
      logger.error(`[HookHelpers] ${managerName}/${name} error: ${err}`);
      results.set(name, { error: String(err) });
    }
  }

  const combined: HookResult = {};
  for (const result of results.values()) {
    if (result.allowed === false) combined.allowed = false;
    if (result.modifiedContent) combined.modifiedContent = result.modifiedContent;
    if (result.additionalContexts?.length) {
      combined.additionalContexts = [
        ...(combined.additionalContexts || []),
        ...result.additionalContexts,
      ];
    }
  }

  return { results, combined };
}

export function enableHook(managerName: string, hookName: string): void {
  const manager = hookManagers.get(managerName);
  if (manager) {
    manager.enabled.add(hookName);
    logger.debug(`[HookHelpers] Enabled ${managerName}/${hookName}`);
  }
}

export function disableHook(managerName: string, hookName: string): void {
  const manager = hookManagers.get(managerName);
  if (manager) {
    manager.enabled.delete(hookName);
    logger.debug(`[HookHelpers] Disabled ${managerName}/${hookName}`);
  }
}

export function clearHooks(managerName: string): void {
  const manager = hookManagers.get(managerName);
  if (manager) {
    manager.hooks.clear();
    manager.enabled.clear();
    logger.debug(`[HookHelpers] Cleared all hooks for ${managerName}`);
  }
}

export function getHookCount(managerName: string): number {
  const manager = hookManagers.get(managerName);
  return manager ? manager.hooks.size : 0;
}

export function getEnabledHookCount(managerName: string): number {
  const manager = hookManagers.get(managerName);
  return manager ? manager.enabled.size : 0;
}

export type { HookContext, HookResult, GenericHook };
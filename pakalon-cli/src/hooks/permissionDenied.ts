/**
 * PermissionDenied Hook
 * Executes when a tool permission is denied
 */
import logger from '@/utils/logger.js';

export interface PermissionDeniedContext {
  toolName: string;
  args: Record<string, any>;
  toolUseId: string;
  reason: string;
  userDenied: boolean;
  timestamp: number;
}

export interface PermissionDeniedResult {
  shouldRetry: boolean;
  error?: string;
  message?: string;
}

export type PermissionDeniedHook = (
  context: PermissionDeniedContext
) => Promise<PermissionDeniedResult | void>;

interface HookRegistration {
  id: string;
  name: string;
  handler: PermissionDeniedHook;
  enabled: boolean;
  priority: number;
}

const permissionDeniedHooks: HookRegistration[] = [];
let hookIdCounter = 0;

function generateHookId(): string {
  return `permissiondenied_${++hookIdCounter}_${Date.now()}`;
}

export function registerPermissionDeniedHook(
  name: string,
  handler: PermissionDeniedHook,
  priority = 0,
): () => void {
  const registration: HookRegistration = {
    id: generateHookId(),
    name,
    handler,
    enabled: true,
    priority,
  };
  permissionDeniedHooks.push(registration);
  permissionDeniedHooks.sort((a, b) => b.priority - a.priority);
  logger.debug(`[PermissionDenied] Registered hook: ${name}`);
  return () => unregisterHook(registration.id);
}

function unregisterHook(id: string): void {
  const index = permissionDeniedHooks.findIndex(h => h.id === id);
  if (index !== -1) {
    permissionDeniedHooks.splice(index, 1);
    logger.debug(`[PermissionDenied] Unregistered hook: ${id}`);
  }
}

export async function executePermissionDeniedHooks(
  context: PermissionDeniedContext,
): Promise<PermissionDeniedResult> {
  let shouldRetry = false;
  let message: string | undefined;

  for (const registration of permissionDeniedHooks) {
    if (!registration.enabled) continue;

    try {
      const result = await registration.handler(context);

      if (result && typeof result === 'object') {
        const hookResult = result as PermissionDeniedResult;
        if (hookResult.shouldRetry) {
          shouldRetry = true;
        }
        if (hookResult.message) {
          message = hookResult.message;
        }
      }
    } catch (err) {
      logger.error(`[PermissionDenied] Hook '${registration.name}' error: ${err}`);
    }
  }

  return { shouldRetry, message };
}

export function clearAllPermissionDeniedHooks(): void {
  permissionDeniedHooks.length = 0;
  logger.debug('[PermissionDenied] Cleared all hooks');
}

export function getPermissionDeniedHookCount(): number {
  return permissionDeniedHooks.filter(h => h.enabled).length;
}

export type { PermissionDeniedContext, PermissionDeniedResult, HookRegistration };
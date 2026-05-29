/**
 * SessionStart Hook
 * Executes when a new session starts
 */
import logger from '@/utils/logger.js';

export interface SessionStartContext {
  sessionId: string;
  projectDir: string;
  userId?: string;
  isResume: boolean;
  resumedSessionId?: string;
  timestamp: number;
}

export interface SessionStartResult {
  additionalContext?: string[];
  modifiedConfig?: Record<string, any>;
}

export type SessionStartHook = (
  context: SessionStartContext
) => Promise<SessionStartResult | void>;

interface HookRegistration {
  id: string;
  name: string;
  handler: SessionStartHook;
  enabled: boolean;
  priority: number;
}

const sessionStartHooks: HookRegistration[] = [];
let hookIdCounter = 0;

function generateHookId(): string {
  return `sessionstart_${++hookIdCounter}_${Date.now()}`;
}

export function registerSessionStartHook(
  name: string,
  handler: SessionStartHook,
  priority = 0,
): () => void {
  const registration: HookRegistration = {
    id: generateHookId(),
    name,
    handler,
    enabled: true,
    priority,
  };
  sessionStartHooks.push(registration);
  sessionStartHooks.sort((a, b) => b.priority - a.priority);
  logger.debug(`[SessionStart] Registered hook: ${name}`);
  return () => unregisterHook(registration.id);
}

function unregisterHook(id: string): void {
  const index = sessionStartHooks.findIndex(h => h.id === id);
  if (index !== -1) {
    sessionStartHooks.splice(index, 1);
    logger.debug(`[SessionStart] Unregistered hook: ${id}`);
  }
}

export async function executeSessionStartHooks(
  context: SessionStartContext,
): Promise<SessionStartResult> {
  const additionalContext: string[] = [];
  const modifiedConfig: Record<string, any> = {};

  for (const registration of sessionStartHooks) {
    if (!registration.enabled) continue;

    try {
      const result = await registration.handler(context);

      if (result && typeof result === 'object') {
        if (result.additionalContext?.length) {
          additionalContext.push(...result.additionalContext);
        }
        if (result.modifiedConfig) {
          Object.assign(modifiedConfig, result.modifiedConfig);
        }
      }
    } catch (err) {
      logger.error(`[SessionStart] Hook '${registration.name}' error: ${err}`);
    }
  }

  return { additionalContext, modifiedConfig };
}

export function clearAllSessionStartHooks(): void {
  sessionStartHooks.length = 0;
  logger.debug('[SessionStart] Cleared all hooks');
}

export function getSessionStartHookCount(): number {
  return sessionStartHooks.filter(h => h.enabled).length;
}

export type { SessionStartContext, SessionStartResult, HookRegistration };
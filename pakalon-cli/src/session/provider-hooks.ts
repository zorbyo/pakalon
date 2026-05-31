/**
 * Provider Hooks System
 * 
 * Comprehensive provider lifecycle hooks based on pi's implementation:
 * - before_provider_request: Modify stream options before request
 * - before_provider_payload: Modify payload before sending
 * - after_provider_response: Handle response headers
 */

import logger from '../utils/logger.js';
import { AgentHarnessError, normalizeHookError } from './errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ProviderRequestContext {
  model: { id: string; provider: string; name: string };
  sessionId: string;
  streamOptions: StreamOptions;
}

export interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  thinkingLevel?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  metadata?: Record<string, unknown>;
  cacheRetention?: string;
  transport?: string;
  timeoutMs?: number;
  maxRetries?: number;
  maxRetryDelayMs?: number;
}

export interface StreamOptionsPatch extends Partial<Omit<StreamOptions, "headers" | "metadata">> {
  headers?: Record<string, string | undefined>;
  metadata?: Record<string, unknown | undefined>;
}

export interface ProviderRequestResult {
  streamOptions?: StreamOptionsPatch;
}

export interface ProviderPayloadContext {
  model: { id: string; provider: string };
  payload: unknown;
}

export interface ProviderPayloadResult {
  payload: unknown;
}

export interface ProviderResponseContext {
  status: number;
  headers: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook Types
// ─────────────────────────────────────────────────────────────────────────────

export type ProviderHookType =
  | "before_provider_request"
  | "before_provider_payload"
  | "after_provider_response";

export interface ProviderHookEvent {
  type: ProviderHookType;
  [key: string]: unknown;
}

export interface ProviderHookHandler<T = unknown> {
  (event: ProviderHookEvent): Promise<T | undefined> | T | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider Hooks Manager
// ─────────────────────────────────────────────────────────────────────────────

export class ProviderHooksManager {
  private handlers = new Map<ProviderHookType, Set<ProviderHookHandler>>();

  /**
   * Register a hook handler
   */
  on<TType extends ProviderHookType>(
    type: TType,
    handler: ProviderHookHandler<TType extends "before_provider_request" ? ProviderRequestResult :
      TType extends "before_provider_payload" ? ProviderPayloadResult : undefined>,
  ): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler as ProviderHookHandler);
    
    return () => {
      this.handlers.get(type)?.delete(handler as ProviderHookHandler);
    };
  }

  /**
   * Emit a hook event
   */
  async emit<TType extends ProviderHookType>(
    type: TType,
    event: TType extends "before_provider_request" ? ProviderRequestContext :
      TType extends "before_provider_payload" ? ProviderPayloadContext :
      ProviderResponseContext,
  ): Promise<TType extends "before_provider_request" ? ProviderRequestResult | undefined :
    TType extends "before_provider_payload" ? ProviderPayloadResult | undefined :
    undefined> {
    const handlers = this.handlers.get(type);
    if (!handlers || handlers.size === 0) {
      return undefined;
    }

    let lastResult: unknown;
    
    for (const handler of handlers) {
      try {
        const result = await handler({ type, ...event } as ProviderHookEvent);
        if (result !== undefined) {
          lastResult = result;
        }
      } catch (error) {
        throw normalizeHookError(error);
      }
    }

    return lastResult as any;
  }

  /**
   * Apply stream options patch
   */
  applyStreamOptionsPatch(
    base: StreamOptions,
    patch?: StreamOptionsPatch,
  ): StreamOptions {
    if (!patch) return base;

    const result = { ...base };

    // Apply simple patches
    if (patch.transport !== undefined) result.transport = patch.transport;
    if (patch.timeoutMs !== undefined) result.timeoutMs = patch.timeoutMs;
    if (patch.maxRetries !== undefined) result.maxRetries = patch.maxRetries;
    if (patch.maxRetryDelayMs !== undefined) result.maxRetryDelayMs = patch.maxRetryDelayMs;
    if (patch.cacheRetention !== undefined) result.cacheRetention = patch.cacheRetention;

    // Apply header patches
    if (patch.headers !== undefined) {
      if (patch.headers === undefined) {
        result.headers = undefined;
      } else {
        const headers = { ...(result.headers ?? {}) };
        for (const [key, value] of Object.entries(patch.headers)) {
          if (value === undefined) {
            delete headers[key];
          } else {
            headers[key] = value;
          }
        }
        result.headers = Object.keys(headers).length > 0 ? headers : undefined;
      }
    }

    // Apply metadata patches
    if (patch.metadata !== undefined) {
      if (patch.metadata === undefined) {
        result.metadata = undefined;
      } else {
        const metadata = { ...(result.metadata ?? {}) };
        for (const [key, value] of Object.entries(patch.metadata)) {
          if (value === undefined) {
            delete metadata[key];
          } else {
            metadata[key] = value;
          }
        }
        result.metadata = Object.keys(metadata).length > 0 ? metadata : undefined;
      }
    }

    return result;
  }

  /**
   * Merge headers
   */
  mergeHeaders(
    ...headers: Array<Record<string, string> | undefined>
  ): Record<string, string> | undefined {
    const merged: Record<string, string> = {};
    let hasHeaders = false;
    
    for (const entry of headers) {
      if (!entry) continue;
      Object.assign(merged, entry);
      hasHeaders = true;
    }
    
    return hasHeaders ? merged : undefined;
  }

  /**
   * Get hook count
   */
  getHookCount(type: ProviderHookType): number {
    return this.handlers.get(type)?.size ?? 0;
  }

  /**
   * Clear all hooks
   */
  clear(): void {
    this.handlers.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

export const providerHooks = new ProviderHooksManager();

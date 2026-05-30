/**
 * Graceful Degradation for Pakalon CLI
 *
 * Handles provider failures by falling back to alternative providers.
 */

import logger from "@/utils/logger.js";
import { healthChecker } from "./health.js";
import { ProviderRegistry, type ProviderClient, type MessageFormat, type StreamingChunk } from "./index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DegradationOptions {
  maxRetries?: number;
  retryDelay?: number;
  fallbackProviders?: string[];
}

export interface DegradationResult<T> {
  success: boolean;
  result?: T;
  error?: string;
  providerUsed?: string;
  fallbackUsed?: boolean;
}

// ---------------------------------------------------------------------------
// Default Configurations
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS: DegradationOptions = {
  maxRetries: 2,
  retryDelay: 1000,
  fallbackProviders: [],
};

// ---------------------------------------------------------------------------
// Fallback Chains
// ---------------------------------------------------------------------------

const FALLBACK_CHAINS: Record<string, string[]> = {
  openrouter: ["ollama", "lmstudio"],
  ollama: ["lmstudio"],
  lmstudio: ["ollama"],
  anthropic: ["openrouter", "ollama"],
  openai: ["openrouter", "ollama"],
  deepseek: ["openrouter", "ollama"],
  gemini: ["openrouter", "ollama"],
};

// ---------------------------------------------------------------------------
// Graceful Degradation Manager
// ---------------------------------------------------------------------------

export class GracefulDegradation {
  private options: DegradationOptions;

  constructor(options: DegradationOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Execute with fallback providers
   */
  async executeWithFallback<T>(
    primaryProvider: string,
    operation: (client: ProviderClient) => Promise<T>,
    options: DegradationOptions = {}
  ): Promise<DegradationResult<T>> {
    const opts = { ...this.options, ...options };
    const providers = this.getProviderChain(primaryProvider, opts.fallbackProviders);

    let lastError: string | undefined;

    for (const providerId of providers) {
      try {
        const client = this.createProviderClient(providerId);
        if (!client) {
          continue;
        }

        const result = await operation(client);

        return {
          success: true,
          result,
          providerUsed: providerId,
          fallbackUsed: providerId !== primaryProvider,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        logger.warn(`[GracefulDegradation] Provider ${providerId} failed: ${lastError}`);

        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          break;
        }

        // Wait before retry
        if (opts.retryDelay) {
          await this.delay(opts.retryDelay);
        }
      }
    }

    return {
      success: false,
      error: lastError || "All providers failed",
    };
  }

  /**
   * Execute chat with fallback
   */
  async chatWithFallback(
    primaryProvider: string,
    messages: MessageFormat[],
    options: { model?: string; temperature?: number; maxTokens?: number } = {}
  ): Promise<DegradationResult<string>> {
    return this.executeWithFallback(
      primaryProvider,
      async (client) => {
        return await client.chat(messages, options);
      },
      this.options
    );
  }

  /**
   * Execute streaming chat with fallback
   */
  async *streamChatWithFallback(
    primaryProvider: string,
    messages: MessageFormat[],
    options: { model?: string; temperature?: number; maxTokens?: number } = {}
  ): AsyncGenerator<StreamingChunk, void, unknown> {
    const providers = this.getProviderChain(primaryProvider, this.options.fallbackProviders);

    for (const providerId of providers) {
      try {
        const client = this.createProviderClient(providerId);
        if (!client) {
          continue;
        }

        yield* client.streamChat(messages, options);
        return; // Success, exit generator
      } catch (error) {
        const lastError = error instanceof Error ? error.message : String(error);
        logger.warn(`[GracefulDegradation] Provider ${providerId} failed: ${lastError}`);

        if (!this.isRetryableError(error)) {
          break;
        }
      }
    }

    // All providers failed
    yield {
      type: "error",
      error: "All providers failed",
    };
  }

  /**
   * Get provider chain with fallbacks
   */
  private getProviderChain(primaryProvider: string, customFallbacks?: string[]): string[] {
    const chain = [primaryProvider];

    if (customFallbacks && customFallbacks.length > 0) {
      chain.push(...customFallbacks);
    } else if (FALLBACK_CHAINS[primaryProvider]) {
      chain.push(...FALLBACK_CHAINS[primaryProvider]);
    }

    return chain;
  }

  /**
   * Create provider client
   */
  private createProviderClient(providerId: string): ProviderClient | null {
    try {
      const { createProviderClient } = require("./index.js");
      return createProviderClient(providerId);
    } catch (error) {
      logger.warn(`[GracefulDegradation] Failed to create client for ${providerId}: ${error}`);
      return null;
    }
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const retryablePatterns = [
      "ECONNREFUSED",
      "ETIMEDOUT",
      "ECONNRESET",
      "timeout",
      "overloaded",
      "rate limit",
      "503",
      "429",
    ];

    const message = error.message.toLowerCase();
    return retryablePatterns.some((pattern) => message.includes(pattern.toLowerCase()));
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Global instance
export const gracefulDegradation = new GracefulDegradation();

// ---------------------------------------------------------------------------
// Convenience Functions
// ---------------------------------------------------------------------------

/**
 * Execute with fallback providers
 */
export async function executeWithFallback<T>(
  primaryProvider: string,
  operation: (client: ProviderClient) => Promise<T>,
  options?: DegradationOptions
): Promise<DegradationResult<T>> {
  return gracefulDegradation.executeWithFallback(primaryProvider, operation, options);
}

/**
 * Chat with fallback providers
 */
export async function chatWithFallback(
  primaryProvider: string,
  messages: MessageFormat[],
  options?: { model?: string; temperature?: number; maxTokens?: number }
): Promise<DegradationResult<string>> {
  return gracefulDegradation.chatWithFallback(primaryProvider, messages, options);
}

/**
 * Stream chat with fallback providers
 */
export async function* streamChatWithFallback(
  primaryProvider: string,
  messages: MessageFormat[],
  options?: { model?: string; temperature?: number; maxTokens?: number }
): AsyncGenerator<StreamingChunk, void, unknown> {
  yield* gracefulDegradation.streamChatWithFallback(primaryProvider, messages, options);
}

/**
 * Get fallback chain for provider
 */
export function getFallbackChain(providerId: string): string[] {
  return gracefulDegradation["getProviderChain"](providerId);
}

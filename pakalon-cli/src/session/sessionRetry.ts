/**
 * Session Retry Logic
 * 
 * Handles API error retry with exponential backoff.
 * Modeled after opencode's session/retry.ts.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Initial delay before first retry (ms) */
export const RETRY_INITIAL_DELAY = 2000;

/** Backoff factor for exponential delay */
export const RETRY_BACKOFF_FACTOR = 2;

/** Max delay without retry-after headers (ms) */
export const RETRY_MAX_DELAY_NO_HEADERS = 30_000;

/** Max delay cap (ms) */
export const RETRY_MAX_DELAY = 2_147_483_647;

/** Max retry attempts */
export const RETRY_MAX_ATTEMPTS = 5;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RetryError {
  statusCode?: number;
  message?: string;
  isRetryable?: boolean;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
}

export interface RetryResult {
  /** Whether to retry */
  shouldRetry: boolean;
  /** Delay before next retry (ms) */
  delayMs: number;
  /** Reason for retry decision */
  reason: string;
  /** Human-readable message */
  message?: string;
}

export interface RetryPolicy {
  /** Maximum number of attempts */
  maxAttempts: number;
  /** Initial delay (ms) */
  initialDelay: number;
  /** Backoff factor */
  backoffFactor: number;
  /** Max delay (ms) */
  maxDelay: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cap delay to maximum value
 */
function capDelay(ms: number): number {
  return Math.min(ms, RETRY_MAX_DELAY);
}

/**
 * Calculate retry delay with exponential backoff
 */
export function calculateDelay(
  attempt: number,
  error?: RetryError,
): number {
  // Check for retry-after header first
  if (error?.responseHeaders) {
    const retryAfterMs = error.responseHeaders['retry-after-ms'];
    if (retryAfterMs) {
      const parsed = parseFloat(retryAfterMs);
      if (!isNaN(parsed)) {
        return capDelay(parsed);
      }
    }

    const retryAfter = error.responseHeaders['retry-after'];
    if (retryAfter) {
      const parsed = parseFloat(retryAfter);
      if (!isNaN(parsed)) {
        return capDelay(Math.ceil(parsed * 1000));
      }
      // Try parsing as HTTP date
      const parsedDate = Date.parse(retryAfter) - Date.now();
      if (!isNaN(parsedDate) && parsedDate > 0) {
        return capDelay(Math.ceil(parsedDate));
      }
    }
  }

  // Exponential backoff
  return capDelay(
    Math.min(
      RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1),
      RETRY_MAX_DELAY_NO_HEADERS,
    ),
  );
}

/**
 * Check if error is retryable
 */
export function isRetryable(error: RetryError, provider?: string): RetryResult {
  const statusCode = error.statusCode;
  const message = error.message ?? '';

  // 429 Rate Limited - always retry
  if (statusCode === 429) {
    return {
      shouldRetry: true,
      delayMs: calculateDelay(1, error),
      reason: 'rate_limit',
      message: 'Rate limited by provider',
    };
  }

  // 5xx Server Errors - retry
  if (statusCode && statusCode >= 500 && statusCode < 600) {
    return {
      shouldRetry: true,
      delayMs: calculateDelay(1, error),
      reason: 'server_error',
      message: `Server error (${statusCode})`,
    };
  }

  // Check for rate limit patterns in message
  const lower = message.toLowerCase();
  if (
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('rate increased too quickly')
  ) {
    return {
      shouldRetry: true,
      delayMs: calculateDelay(1, error),
      reason: 'rate_limit',
      message: message,
    };
  }

  // Check for overloaded patterns
  if (
    lower.includes('overloaded') ||
    lower.includes('exhausted') ||
    lower.includes('unavailable')
  ) {
    return {
      shouldRetry: true,
      delayMs: calculateDelay(1, error),
      reason: 'overloaded',
      message: 'Provider is overloaded',
    };
  }

  // Check isRetryable flag
  if (error.isRetryable) {
    return {
      shouldRetry: true,
      delayMs: calculateDelay(1, error),
      reason: 'retryable',
      message: message,
    };
  }

  // Non-retryable error
  return {
    shouldRetry: false,
    delayMs: 0,
    reason: 'non_retryable',
    message: message,
  };
}

/**
 * Create a retry policy with default settings
 */
export function createRetryPolicy(overrides?: Partial<RetryPolicy>): RetryPolicy {
  return {
    maxAttempts: RETRY_MAX_ATTEMPTS,
    initialDelay: RETRY_INITIAL_DELAY,
    backoffFactor: RETRY_BACKOFF_FACTOR,
    maxDelay: RETRY_MAX_DELAY,
    ...overrides,
  };
}

/**
 * Execute with retry
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  provider?: string,
  policy?: RetryPolicy,
): Promise<T> {
  const retryPolicy = createRetryPolicy(policy);
  let lastError: RetryError | undefined;

  for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryError: RetryError = {
        statusCode: (err as any)?.statusCode ?? (err as any)?.status,
        message: (err as Error)?.message,
        isRetryable: (err as any)?.isRetryable,
        responseHeaders: (err as any)?.headers,
      };

      const result = isRetryable(retryError, provider);
      lastError = retryError;

      if (!result.shouldRetry || attempt === retryPolicy.maxAttempts) {
        throw err;
      }

      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, result.delayMs));
    }
  }

  throw lastError ?? new Error('Max retries exceeded');
}

export * as SessionRetry from './sessionRetry.js';

export interface ProviderErrorOptions {
  statusCode: number;
  retryAfter?: number;
  isRetryable?: boolean;
  cause?: unknown;
}

export interface ClaudeCodeSSEErrorPayload {
  type: string;
  message: string;
  statusCode: number;
  isRetryable: boolean;
  retryAfter?: number;
  midStream?: boolean;
  recoveryHint?: string;
  cursor?: string;
}

export interface SSEEvent {
  event: string;
  data: string;
  id?: string;
  retry?: number;
}

export interface SSERecoveryInfo {
  recoverable: boolean;
  retryAfterMs?: number;
  cursor?: string;
  reason: string;
}

function normalizeRetryAfter(retryAfter?: number): number | undefined {
  if (typeof retryAfter !== 'number' || !Number.isFinite(retryAfter)) {
    return undefined;
  }

  return retryAfter > 0 ? Math.floor(retryAfter) : undefined;
}

function safeSerialize(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function createErrorMessage(message: string, statusCode: number): string {
  return `${message} (HTTP ${statusCode})`;
}

export class ProviderError extends Error {
  public readonly statusCode: number;
  public readonly retryAfter?: number;
  public readonly isRetryable: boolean;

  constructor(message: string, options: ProviderErrorOptions) {
    super(createErrorMessage(message, options.statusCode), { cause: options.cause });
    this.name = 'ProviderError';
    this.statusCode = options.statusCode;
    this.retryAfter = normalizeRetryAfter(options.retryAfter);
    this.isRetryable = options.isRetryable ?? false;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toSSEEvent(id?: string): string {
    return formatErrorToClaudeCodeSSE(this, { id });
  }
}

export class AuthenticationError extends ProviderError {
  constructor(message = 'Authentication failed', options: Omit<ProviderErrorOptions, 'statusCode' | 'isRetryable'> = {}) {
    super(message, { ...options, statusCode: 401, isRetryable: false });
    this.name = 'AuthenticationError';
  }
}

export class InvalidRequestError extends ProviderError {
  constructor(message = 'Invalid request', options: Omit<ProviderErrorOptions, 'statusCode' | 'isRetryable'> = {}) {
    super(message, { ...options, statusCode: 400, isRetryable: false });
    this.name = 'InvalidRequestError';
  }
}

export class RateLimitError extends ProviderError {
  constructor(message = 'Rate limit exceeded', options: Omit<ProviderErrorOptions, 'statusCode' | 'isRetryable'> = {}) {
    super(message, { ...options, statusCode: 429, isRetryable: true });
    this.name = 'RateLimitError';
  }
}

export class OverloadedError extends ProviderError {
  constructor(message = 'Provider overloaded', options: Omit<ProviderErrorOptions, 'statusCode' | 'isRetryable'> = {}) {
    super(message, { ...options, statusCode: 529, isRetryable: true });
    this.name = 'OverloadedError';
  }
}

export class APIError extends ProviderError {
  constructor(message = 'API error', options: Omit<ProviderErrorOptions, 'statusCode' | 'isRetryable'> = {}) {
    super(message, { ...options, statusCode: 500, isRetryable: true });
    this.name = 'APIError';
  }
}

export class ServiceUnavailableError extends ProviderError {
  constructor(message = 'Service unavailable', options: Omit<ProviderErrorOptions, 'statusCode' | 'isRetryable'> = {}) {
    super(message, { ...options, statusCode: 503, isRetryable: true });
    this.name = 'ServiceUnavailableError';
  }
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}

export function isRetryableProviderError(error: unknown): error is ProviderError {
  return isProviderError(error) && error.isRetryable;
}

export function getProviderErrorRecoveryInfo(error: unknown, cursor?: string): SSERecoveryInfo {
  if (error instanceof ProviderError) {
    return {
      recoverable: error.isRetryable,
      retryAfterMs: error.retryAfter,
      cursor,
      reason: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      recoverable: true,
      cursor,
      reason: error.message,
    };
  }

  return {
    recoverable: true,
    cursor,
    reason: safeSerialize(error),
  };
}

export function createMidStreamRecoverySSE(error: unknown, options: { cursor?: string; id?: string } = {}): string {
  const recovery = getProviderErrorRecoveryInfo(error, options.cursor);
  const payload: ClaudeCodeSSEErrorPayload = {
    type: error instanceof ProviderError ? error.name : 'StreamError',
    message: recovery.reason,
    statusCode: error instanceof ProviderError ? error.statusCode : 500,
    isRetryable: recovery.recoverable,
    retryAfter: error instanceof ProviderError ? error.retryAfter : undefined,
    midStream: true,
    recoveryHint: recovery.recoverable ? 'resume-stream' : 'abort-stream',
    cursor: recovery.cursor,
  };

  return formatSSEEvent({
    event: 'error',
    data: JSON.stringify(payload),
    id: options.id,
    retry: payload.retryAfter,
  });
}

export function formatErrorToClaudeCodeSSE(
  error: unknown,
  options: { id?: string; cursor?: string; midStream?: boolean } = {}
): string {
  const recovery = getProviderErrorRecoveryInfo(error, options.cursor);
  const payload: ClaudeCodeSSEErrorPayload = {
    type: error instanceof ProviderError ? error.name : error instanceof Error ? error.name : 'Error',
    message: recovery.reason,
    statusCode: error instanceof ProviderError ? error.statusCode : 500,
    isRetryable: recovery.recoverable,
    retryAfter: error instanceof ProviderError ? error.retryAfter : undefined,
    midStream: options.midStream,
    recoveryHint: recovery.recoverable ? 'retry' : 'fatal',
    cursor: recovery.cursor,
  };

  return formatSSEEvent({
    event: 'error',
    data: JSON.stringify(payload),
    id: options.id,
    retry: payload.retryAfter,
  });
}

export function formatSSEEvent(event: SSEEvent): string {
  const lines = [`event: ${event.event}`];

  if (event.id) {
    lines.push(`id: ${event.id}`);
  }

  if (typeof event.retry === 'number') {
    lines.push(`retry: ${event.retry}`);
  }

  for (const line of event.data.split(/\r?\n/)) {
    lines.push(`data: ${line}`);
  }

  return `${lines.join('\n')}\n\n`;
}

export function formatProviderErrorAsSSE(error: unknown, id?: string): string {
  return formatErrorToClaudeCodeSSE(error, { id });
}

export function shouldRecoverFromStreamError(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return error.isRetryable;
  }

  return error instanceof Error;
}

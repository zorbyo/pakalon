/**
 * provider-errors.ts — Typed error hierarchy for AI provider errors.
 *
 * Each error class maps to a specific HTTP status code or provider error type
 * and exposes a toUserFriendlyMessage() method for TUI-safe display.
 */

export class ProviderError extends Error {
  public readonly status_code: number;
  public readonly error_type: string;

  constructor(
    message: string,
    status_code: number,
    error_type = "provider_error",
  ) {
    super(message);
    this.name = "ProviderError";
    this.status_code = status_code;
    this.error_type = error_type;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toUserFriendlyMessage(): string {
    return `[${this.error_type}] ${this.message} (HTTP ${this.status_code})`;
  }
}

export class AuthenticationError extends ProviderError {
  constructor(message = "Invalid API key — check OPENROUTER_API_KEY") {
    super(message, 401, "authentication_error");
    this.name = "AuthenticationError";
  }

  toUserFriendlyMessage(): string {
    return `Authentication failed: ${this.message}. Run "pakalon login" or set OPENROUTER_API_KEY.`;
  }
}

export class InvalidRequestError extends ProviderError {
  public readonly param?: string;

  constructor(
    message = "The request was malformed or unsupported",
    param?: string,
  ) {
    super(message, 400, "invalid_request_error");
    this.name = "InvalidRequestError";
    this.param = param;
  }

  toUserFriendlyMessage(): string {
    const detail = this.param ? ` (parameter: ${this.param})` : "";
    return `Invalid request${detail}: ${this.message}. Try rephrasing or use /reset.`;
  }
}

export class RateLimitError extends ProviderError {
  public readonly retryAfterMs?: number;

  constructor(
    message = "Rate limit exceeded",
    retryAfterMs?: number,
  ) {
    super(message, 429, "rate_limit_error");
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }

  toUserFriendlyMessage(): string {
    const timing = this.retryAfterMs
      ? ` Retry in ${Math.ceil(this.retryAfterMs / 1000)}s.`
      : " Try again shortly.";
    return `Rate limited: ${this.message}.${timing}`;
  }
}

export class OverloadedError extends ProviderError {
  public readonly retryAfterMs?: number;

  constructor(
    message = "The AI provider is overloaded",
    retryAfterMs?: number,
  ) {
    super(message, 529, "overloaded_error");
    this.name = "OverloadedError";
    this.retryAfterMs = retryAfterMs;
  }

  toUserFriendlyMessage(): string {
    const timing = this.retryAfterMs
      ? ` Retry in ${Math.ceil(this.retryAfterMs / 1000)}s.`
      : " Try again shortly.";
    return `Provider overloaded: ${this.message}.${timing} Or switch models with /models.`;
  }
}

export class APIError extends ProviderError {
  constructor(message = "An unexpected server error occurred") {
    super(message, 500, "api_error");
    this.name = "APIError";
  }

  toUserFriendlyMessage(): string {
    return `Server error: ${this.message}. This is usually temporary — try again in a moment.`;
  }
}

export class ServiceUnavailableError extends ProviderError {
  public readonly retryAfterMs?: number;

  constructor(
    message = "The service is temporarily unavailable",
    retryAfterMs?: number,
  ) {
    super(message, 503, "service_unavailable");
    this.name = "ServiceUnavailableError";
    this.retryAfterMs = retryAfterMs;
  }

  toUserFriendlyMessage(): string {
    const timing = this.retryAfterMs
      ? ` Expected downtime: ${Math.ceil(this.retryAfterMs / 1000)}s.`
      : "";
    return `Service unavailable: ${this.message}.${timing}`;
  }
}

export class UnknownProviderTypeError extends ProviderError {
  public readonly rawType: string;

  constructor(rawType: string, message?: string) {
    super(
      message ?? `Unrecognized provider error type: "${rawType}"`,
      0,
      "unknown_provider_error",
    );
    this.name = "UnknownProviderTypeError";
    this.rawType = rawType;
  }

  toUserFriendlyMessage(): string {
    return `Unknown error from provider (type: "${this.rawType}"): ${this.message}`;
  }
}

/**
 * Factory: classify an error from status code and optional provider error type string.
 * Reads OpenRouter-style error shapes when available.
 */
export function classifyError(
  status_code: number,
  error_type?: string,
  message?: string,
  originalError?: unknown,
): ProviderError {
  const msg = message ?? extractMessageFromUnknown(originalError) ?? "Unknown error";

  // Prefer explicit error_type when provided
  if (error_type) {
    switch (error_type) {
      case "authentication_error":
      case "unauthorized":
        return new AuthenticationError(msg);
      case "invalid_request_error":
      case "bad_request":
        return new InvalidRequestError(msg);
      case "rate_limit_error":
      case "rate_limited":
        return new RateLimitError(msg);
      case "overloaded_error":
      case "overloaded":
        return new OverloadedError(msg);
      case "api_error":
      case "internal_error":
        return new APIError(msg);
      case "service_unavailable":
        return new ServiceUnavailableError(msg);
      default:
        return new UnknownProviderTypeError(error_type, msg);
    }
  }

  // Fallback: classify by status code
  switch (status_code) {
    case 400:
      return new InvalidRequestError(msg);
    case 401:
      return new AuthenticationError(msg);
    case 403:
      return new AuthenticationError(`Forbidden: ${msg}`);
    case 429:
      return new RateLimitError(msg);
    case 500:
      return new APIError(msg);
    case 503:
      return new ServiceUnavailableError(msg);
    case 529:
      return new OverloadedError(msg);
    default:
      return new UnknownProviderTypeError(
        String(status_code),
        msg,
      );
  }
}

/**
 * Extract a human-readable message from an unknown error.
 */
function extractMessageFromUnknown(err: unknown): string | undefined {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.detail === "string" && obj.detail.trim()) return obj.detail;
    if (typeof obj.message === "string" && obj.message.trim()) return obj.message;
  }
  return undefined;
}

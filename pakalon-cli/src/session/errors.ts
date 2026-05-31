/**
 * Typed Error Classes for Session and Harness Systems
 * 
 * Based on pi's error handling pattern with typed error codes
 * for better debugging and error recovery.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Result Type
// ─────────────────────────────────────────────────────────────────────────────

/** Result of a fallible operation. Expected failures are returned as `ok: false` instead of thrown. */
export type Result<TValue, TError> = { ok: true; value: TValue } | { ok: false; error: TError };

/** Create a successful Result. */
export function ok<TValue, TError>(value: TValue): Result<TValue, TError> {
  return { ok: true, value };
}

/** Create a failed Result. */
export function err<TValue, TError>(error: TError): Result<TValue, TError> {
  return { ok: false, error };
}

/** Return the success value or throw the failure error. */
export function getOrThrow<TValue, TError>(result: Result<TValue, TError>): TValue {
  if (!result.ok) throw (result as { ok: false; error: TError }).error;
  return result.value;
}

/** Return the success value or undefined. */
export function getOrUndefined<TValue extends object, TError>(result: Result<TValue, TError>): TValue | undefined {
  return result.ok ? result.value : undefined;
}

/** Normalize unknown thrown values into Error instances. */
export function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error(String(error));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// File System Errors
// ─────────────────────────────────────────────────────────────────────────────

export type FileErrorCode =
  | "aborted"
  | "not_found"
  | "permission_denied"
  | "not_directory"
  | "is_directory"
  | "invalid"
  | "not_supported"
  | "unknown";

export class FileError extends Error {
  public code: FileErrorCode;
  public path?: string;

  constructor(code: FileErrorCode, message: string, path?: string, cause?: Error) {
    super(message);
    this.name = "FileError";
    this.code = code;
    this.path = path;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Errors
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutionErrorCode =
  | "aborted"
  | "timeout"
  | "shell_unavailable"
  | "spawn_error"
  | "callback_error"
  | "unknown";

export class ExecutionError extends Error {
  public code: ExecutionErrorCode;

  constructor(code: ExecutionErrorCode, message: string, cause?: Error) {
    super(message);
    this.name = "ExecutionError";
    this.code = code;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Errors
// ─────────────────────────────────────────────────────────────────────────────

export type SessionErrorCode =
  | "not_found"
  | "invalid_session"
  | "invalid_entry"
  | "invalid_fork_target"
  | "storage"
  | "unknown";

export class SessionError extends Error {
  public code: SessionErrorCode;

  constructor(code: SessionErrorCode, message: string, cause?: Error) {
    super(message);
    this.name = "SessionError";
    this.code = code;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Compaction Errors
// ─────────────────────────────────────────────────────────────────────────────

export type CompactionErrorCode = "aborted" | "summarization_failed" | "invalid_session" | "unknown";

export class CompactionError extends Error {
  public code: CompactionErrorCode;

  constructor(code: CompactionErrorCode, message: string, cause?: Error) {
    super(message);
    this.name = "CompactionError";
    this.code = code;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Branch Summary Errors
// ─────────────────────────────────────────────────────────────────────────────

export type BranchSummaryErrorCode = "aborted" | "summarization_failed" | "invalid_session";

export class BranchSummaryError extends Error {
  public code: BranchSummaryErrorCode;

  constructor(code: BranchSummaryErrorCode, message: string, cause?: Error) {
    super(message);
    this.name = "BranchSummaryError";
    this.code = code;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Harness Errors
// ─────────────────────────────────────────────────────────────────────────────

export type AgentHarnessErrorCode =
  | "busy"
  | "invalid_state"
  | "invalid_argument"
  | "session"
  | "hook"
  | "auth"
  | "compaction"
  | "branch_summary"
  | "unknown";

export class AgentHarnessError extends Error {
  public code: AgentHarnessErrorCode;

  constructor(code: AgentHarnessErrorCode, message: string, cause?: Error) {
    super(message);
    this.name = "AgentHarnessError";
    this.code = code;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Normalization Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeHarnessError(error: unknown, fallbackCode: AgentHarnessErrorCode): AgentHarnessError {
  if (error instanceof AgentHarnessError) return error;
  const cause = toError(error);
  if (cause instanceof SessionError) return new AgentHarnessError("session", cause.message, cause);
  if (cause instanceof CompactionError) return new AgentHarnessError("compaction", cause.message, cause);
  if (cause instanceof BranchSummaryError) return new AgentHarnessError("branch_summary", cause.message, cause);
  return new AgentHarnessError(fallbackCode, cause.message, cause);
}

export function normalizeHookError(error: unknown): AgentHarnessError {
  return normalizeHarnessError(error, "hook");
}

/**
 * Session ID tag translation helpers for the CCR v2 compat layer.
 *
 * The isCseShimEnabled kill switch is injected via setCseShimGate() to avoid
 * a static import of bridgeEnabled.ts. Callers that already import bridgeEnabled.ts
 * register the gate; the SDK path never does, so the shim defaults to active.
 */

import type { BridgeConfig, BackoffConfig, PollIntervalConfig } from "./types.js";

let _isCseShimEnabled: (() => boolean) | undefined;

export function setCseShimGate(gate: () => boolean): void {
  _isCseShimEnabled = gate;
}

export function isCseShimEnabled(): boolean {
  return _isCseShimEnabled ? _isCseShimEnabled() : true;
}

/**
 * Re-tag a `cse_*` session ID to `session_*` for use with the v1 compat API.
 * No-op for IDs that aren't `cse_*`.
 */
export function toCompatSessionId(id: string): string {
  if (!id.startsWith("cse_")) return id;
  if (_isCseShimEnabled && !_isCseShimEnabled()) return id;
  return "session_" + id.slice("cse_".length);
}

/**
 * Re-tag a `session_*` session ID to `cse_*` for infrastructure-layer calls.
 * No-op for IDs that aren't `session_*`.
 */
export function toInfraSessionId(id: string): string {
  if (!id.startsWith("session_")) return id;
  return "cse_" + id.slice("session_".length);
}

/**
 * Compare two session IDs regardless of their tagged-ID prefix.
 * Both have the same underlying UUID.
 */
export function sameSessionId(a: string, b: string): boolean {
  if (a === b) return true;
  const aBody = a.slice(a.lastIndexOf("_") + 1);
  const bBody = b.slice(b.lastIndexOf("_") + 1);
  return aBody.length >= 4 && aBody === bBody;
}

// Re-export types for convenience
export type { BridgeConfig, BackoffConfig, PollIntervalConfig };
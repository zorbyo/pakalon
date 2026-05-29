/**
 * JWT utilities for bridge token management.
 *
 * Handles JWT decoding for expiry extraction and provides
 * a token refresh scheduler for proactive token renewal.
 */

import type { TokenRefreshScheduler } from "./types.js";

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes
const FALLBACK_REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_REFRESH_FAILURES = 3;
const REFRESH_RETRY_DELAY_MS = 60_000;

/**
 * Decode a JWT's payload segment without verifying the signature.
 */
export function decodeJwtPayload(token: string): unknown | null {
  const jwt = token.startsWith("sk-ant-si-")
    ? token.slice("sk-ant-si-".length)
    : token;
  const parts = jwt.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Decode the `exp` (expiry) claim from a JWT without verifying the signature.
 * @returns The `exp` value in Unix seconds, or `null` if unparseable
 */
export function decodeJwtExpiry(token: string): number | null {
  const payload = decodeJwtPayload(token);
  if (
    payload !== null &&
    typeof payload === "object" &&
    "exp" in payload &&
    typeof payload.exp === "number"
  ) {
    return payload.exp;
  }
  return null;
}

/**
 * Format a millisecond duration as a human-readable string.
 */
function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/**
 * Creates a token refresh scheduler that proactively refreshes session tokens
 * before they expire.
 */
export function createTokenRefreshScheduler({
  getAccessToken,
  onRefresh,
  label,
  refreshBufferMs = TOKEN_REFRESH_BUFFER_MS,
}: {
  getAccessToken: () => string | undefined | Promise<string | undefined>;
  onRefresh: (sessionId: string, oauthToken: string) => void;
  label: string;
  refreshBufferMs?: number;
}): TokenRefreshScheduler {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const failureCounts = new Map<string, number>();
  const generations = new Map<string, number>();

  function nextGeneration(sessionId: string): number {
    const gen = (generations.get(sessionId) ?? 0) + 1;
    generations.set(sessionId, gen);
    return gen;
  }

  function schedule(sessionId: string, token: string): void {
    const expiry = decodeJwtExpiry(token);
    if (!expiry) {
      return;
    }

    const existing = timers.get(sessionId);
    if (existing) {
      clearTimeout(existing);
    }

    const gen = nextGeneration(sessionId);
    const expiryDate = new Date(expiry * 1000).toISOString();
    const delayMs = expiry * 1000 - Date.now() - refreshBufferMs;

    if (delayMs <= 0) {
      void doRefresh(sessionId, gen);
      return;
    }

    const timer = setTimeout(doRefresh, delayMs, sessionId, gen);
    timers.set(sessionId, timer);
  }

  function scheduleFromExpiresIn(
    sessionId: string,
    expiresInSeconds: number
  ): void {
    const existing = timers.get(sessionId);
    if (existing) clearTimeout(existing);
    const gen = nextGeneration(sessionId);
    const delayMs = Math.max(
      expiresInSeconds * 1000 - refreshBufferMs,
      30_000
    );
    const timer = setTimeout(doRefresh, delayMs, sessionId, gen);
    timers.set(sessionId, timer);
  }

  async function doRefresh(sessionId: string, gen: number): Promise<void> {
    let oauthToken: string | undefined;
    try {
      oauthToken = await getAccessToken();
    } catch (err) {
      // Log error
    }

    if (generations.get(sessionId) !== gen) {
      return;
    }

    if (!oauthToken) {
      const failures = (failureCounts.get(sessionId) ?? 0) + 1;
      failureCounts.set(sessionId, failures);

      if (failures < MAX_REFRESH_FAILURES) {
        const retryTimer = setTimeout(
          doRefresh,
          REFRESH_RETRY_DELAY_MS,
          sessionId,
          gen
        );
        timers.set(sessionId, retryTimer);
      }
      return;
    }

    failureCounts.delete(sessionId);
    onRefresh(sessionId, oauthToken);

    const timer = setTimeout(
      doRefresh,
      FALLBACK_REFRESH_INTERVAL_MS,
      sessionId,
      gen
    );
    timers.set(sessionId, timer);
  }

  function cancel(sessionId: string): void {
    nextGeneration(sessionId);
    const timer = timers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      timers.delete(sessionId);
    }
    failureCounts.delete(sessionId);
  }

  function cancelAll(): void {
    for (const sessionId of generations.keys()) {
      nextGeneration(sessionId);
    }
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    timers.clear();
    failureCounts.clear();
  }

  return { schedule, scheduleFromExpiresIn, cancel, cancelAll };
}

export type { TokenRefreshScheduler };
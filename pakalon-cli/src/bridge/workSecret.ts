/**
 * Work secret handling for bridge sessions.
 *
 * Decodes base64url-encoded work secrets and provides URL builders
 * for both v1 (WebSocket) and v2 (CCR/SSE) session transports.
 */

import type { WorkSecret, RemoteCredentials } from "./types.js";
import { sameSessionId as sameSessionIdUtil } from "./sessionIdCompat.js";

/**
 * Decode a base64url-encoded work secret and validate its version.
 */
export function decodeWorkSecret(secret: string): WorkSecret {
  const json = Buffer.from(secret, "base64url").toString("utf-8");
  const parsed: unknown = JSON.parse(json);

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("version" in parsed) ||
    (parsed as Record<string, unknown>).version !== 1
  ) {
    throw new Error(
      `Unsupported work secret version: ${
        parsed && typeof parsed === "object" && "version" in parsed
          ? (parsed as Record<string, unknown>).version
          : "unknown"
      }`
    );
  }

  const obj = parsed as Record<string, unknown>;

  if (
    typeof obj.session_ingress_token !== "string" ||
    obj.session_ingress_token.length === 0
  ) {
    throw new Error(
      "Invalid work secret: missing or empty session_ingress_token"
    );
  }

  if (typeof obj.api_base_url !== "string") {
    throw new Error("Invalid work secret: missing api_base_url");
  }

  return parsed as WorkSecret;
}

/**
 * Build a WebSocket SDK URL from the API base URL and session ID.
 * Uses /v2/ for localhost and /v1/ for production.
 */
export function buildSdkUrl(apiBaseUrl: string, sessionId: string): string {
  const isLocalhost =
    apiBaseUrl.includes("localhost") || apiBaseUrl.includes("127.0.0.1");
  const protocol = isLocalhost ? "ws" : "wss";
  const version = isLocalhost ? "v2" : "v1";
  const host = apiBaseUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `${protocol}://${host}/${version}/session_ingress/ws/${sessionId}`;
}

/**
 * Build a CCR v2 session URL from the API base URL and session ID.
 * Returns an HTTP(S) URL pointing at /v1/code/sessions/{id}.
 */
export function buildCCRv2SdkUrl(
  apiBaseUrl: string,
  sessionId: string
): string {
  const base = apiBaseUrl.replace(/\/+$/, "");
  return `${base}/v1/code/sessions/${sessionId}`;
}

/**
 * Register this bridge as the worker for a CCR v2 session.
 * Returns the worker_epoch which must be passed to the child process.
 */
export async function registerWorker(
  sessionUrl: string,
  accessToken: string
): Promise<number> {
  // In a full implementation:
  // POST ${sessionUrl}/worker/register
  // Returns { worker_epoch: number }

  // Placeholder implementation
  return Date.now();
}

/**
 * Create a new code session via the v2 API.
 */
export async function createCodeSession(
  baseUrl: string,
  accessToken: string,
  title: string,
  _timeoutMs: number,
  tags?: string[]
): Promise<string | null> {
  // POST /v1/code/sessions
  // In a full implementation, this would call the actual API

  // Placeholder - return a generated session ID
  return `cse_${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Fetch bridge credentials (worker JWT, expires_in, api_base_url) for a session.
 */
export async function fetchRemoteCredentials(
  sessionId: string,
  baseUrl: string,
  accessToken: string,
  _timeoutMs: number,
  _trustedDeviceToken?: string
): Promise<RemoteCredentials | null> {
  // POST /v1/code/sessions/{id}/bridge
  // Returns { worker_jwt, expires_in, api_base_url, worker_epoch }

  // Placeholder implementation
  return {
    worker_jwt: accessToken,
    expires_in: 14400, // 4 hours
    api_base_url: baseUrl,
    worker_epoch: Date.now(),
  };
}

export { sameSessionIdUtil as sameSessionId };
export type { WorkSecret, RemoteCredentials };
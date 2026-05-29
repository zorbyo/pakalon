/**
 * Bridge API client for environments and sessions.
 *
 * Provides the HTTP interface to the bridge backend for:
 * - Environment registration
 * - Work polling
 * - Session management
 * - Heartbeat
 */

import type {
  BridgeConfig,
  BridgeApiClient,
  WorkResponse,
  PermissionResponseEvent,
} from "./types.js";

export class BridgeFatalError extends Error {
  readonly status: number;
  readonly errorType: string | undefined;

  constructor(message: string, status: number, errorType?: string) {
    super(message);
    this.name = "BridgeFatalError";
    this.status = status;
    this.errorType = errorType;
  }
}

export function isExpiredErrorType(errorType: string | undefined): boolean {
  if (!errorType) return false;
  return errorType.includes("expired") || errorType.includes("lifetime");
}

export function isSuppressible403(err: BridgeFatalError): boolean {
  if (err.status !== 403) return false;
  return (
    err.message.includes("external_poll_sessions") ||
    err.message.includes("environments:manage")
  );
}

export function validateBridgeId(id: string, label: string): string {
  const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
  if (!id || !SAFE_ID_PATTERN.test(id)) {
    throw new Error(`Invalid ${label}: contains unsafe characters`);
  }
  return id;
}

type BridgeApiDeps = {
  baseUrl: string;
  getAccessToken: () => string | undefined;
  runnerVersion: string;
  onDebug?: (msg: string) => void;
  onAuth401?: (staleAccessToken: string) => Promise<boolean>;
  getTrustedDeviceToken?: () => string | undefined;
};

export function createBridgeApiClient(deps: BridgeApiDeps): BridgeApiClient {
  function debug(msg: string): void {
    deps.onDebug?.(msg);
  }

  function getHeaders(accessToken: string): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-environment-runner-version": deps.runnerVersion,
    };
    const deviceToken = deps.getTrustedDeviceToken?.();
    if (deviceToken) {
      headers["X-Trusted-Device-Token"] = deviceToken;
    }
    return headers;
  }

  function resolveAuth(): string {
    const accessToken = deps.getAccessToken();
    if (!accessToken) {
      throw new Error(
        "Remote Control is only available with claude.ai subscriptions. Please use `/login` to sign in with your claude.ai account."
      );
    }
    return accessToken;
  }

  async function withOAuthRetry<T>(
    fn: (accessToken: string) => Promise<{ status: number; data: T }>,
    context: string
  ): Promise<{ status: number; data: T }> {
    const accessToken = resolveAuth();
    const response = await fn(accessToken);

    if (response.status !== 401) {
      return response;
    }

    if (!deps.onAuth401) {
      return response;
    }

    const refreshed = await deps.onAuth401(accessToken);
    if (refreshed) {
      const newToken = resolveAuth();
      const retryResponse = await fn(newToken);
      if (retryResponse.status !== 401) {
        return retryResponse;
      }
    }

    return response;
  }

  function handleErrorStatus(
    status: number,
    data: unknown,
    context: string
  ): void {
    if (status === 200 || status === 204) {
      return;
    }

    const detail = extractErrorDetail(data);
    const errorType = extractErrorTypeFromData(data);

    switch (status) {
      case 401:
        throw new BridgeFatalError(
          `${context}: Authentication failed (401)${detail ? `: ${detail}` : ""}`,
          401,
          errorType
        );
      case 403:
        throw new BridgeFatalError(
          isExpiredErrorType(errorType)
            ? "Remote Control session has expired. Please restart with `pakalon remote-control`."
            : `${context}: Access denied (403)${detail ? `: ${detail}` : ""}`,
          403,
          errorType
        );
      case 404:
        throw new BridgeFatalError(
          detail ??
            `${context}: Not found (404). Remote Control may not be available for this organization.`,
          404,
          errorType
        );
      case 410:
        throw new BridgeFatalError(
          detail ??
            "Remote Control session has expired. Please restart with `pakalon remote-control`.",
          410,
          errorType ?? "environment_expired"
        );
      case 429:
        throw new Error(`${context}: Rate limited (429). Polling too frequently.`);
      default:
        throw new Error(
          `${context}: Failed with status ${status}${detail ? `: ${detail}` : ""}`
        );
    }
  }

  return {
    async registerBridgeEnvironment(
      config: BridgeConfig
    ): Promise<{ environment_id: string; environment_secret: string }> {
      debug(
        `[bridge:api] POST /v1/environments/bridge bridgeId=${config.bridgeId}`
      );

      // In a full implementation, this would POST to the actual API
      // For now, return mock data
      const environmentId = `env_${Date.now()}`;
      const environmentSecret = `secret_${Math.random().toString(36).slice(2)}`;

      return { environment_id: environmentId, environment_secret: environmentSecret };
    },

    async pollForWork(
      environmentId: string,
      _environmentSecret: string,
      _signal?: AbortSignal,
      _reclaimOlderThanMs?: number
    ): Promise<WorkResponse | null> {
      validateBridgeId(environmentId, "environmentId");

      // In a full implementation, this would GET /v1/environments/{id}/work/poll
      // Return null for no work available
      return null;
    },

    async acknowledgeWork(
      _environmentId: string,
      _workId: string,
      _sessionToken: string
    ): Promise<void> {
      // POST /v1/environments/{id}/work/{id}/ack
    },

    async stopWork(
      _environmentId: string,
      _workId: string,
      _force: boolean
    ): Promise<void> {
      // POST /v1/environments/{id}/work/{id}/stop
    },

    async deregisterEnvironment(_environmentId: string): Promise<void> {
      // DELETE /v1/environments/bridge/{environmentId}
    },

    async sendPermissionResponseEvent(
      _sessionId: string,
      _event: PermissionResponseEvent,
      _sessionToken: string
    ): Promise<void> {
      // POST /v1/sessions/{id}/events
    },

    async archiveSession(_sessionId: string): Promise<void> {
      // POST /v1/sessions/{id}/archive
    },

    async reconnectSession(
      _environmentId: string,
      _sessionId: string
    ): Promise<void> {
      // POST /v1/environments/{id}/bridge/reconnect
    },

    async heartbeatWork(
      _environmentId: string,
      _workId: string,
      _sessionToken: string
    ): Promise<{ lease_extended: boolean; state: string }> {
      // POST /v1/environments/{id}/work/{id}/heartbeat
      return { lease_extended: true, state: "active" };
    },
  };
}

function extractErrorDetail(data: unknown): string | undefined {
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if ("detail" in obj && typeof obj.detail === "string") {
      return obj.detail;
    }
    if ("message" in obj && typeof obj.message === "string") {
      return obj.message;
    }
  }
  return undefined;
}

function extractErrorTypeFromData(data: unknown): string | undefined {
  if (data && typeof data === "object") {
    if (
      "error" in data &&
      data.error &&
      typeof data.error === "object" &&
      "type" in (data.error as Record<string, unknown>) &&
      typeof (data.error as Record<string, unknown>).type === "string"
    ) {
      return (data.error as Record<string, unknown>).type as string;
    }
  }
  return undefined;
}

export type { BridgeApiClient, BridgeApiDeps };
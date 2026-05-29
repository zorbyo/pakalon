/**
 * Pakalon Bridge/CCR (Cloud Code Remote) Implementation
 *
 * A complete implementation of the CCR bridge protocol for remote session
 * sharing between the pakalon CLI and claude.ai/code.
 *
 * Key components:
 * - BridgeConfig, BridgeApiClient: Configuration and API client types
 * - SessionHandle, SessionSpawner: Session lifecycle management
 * - runBridgeLoop: Main polling loop for work items
 * - Remote session creation and management via WebSocket/SSE transports
 * - JWT token refresh scheduling
 * - Trusted device authentication
 * - Poll configuration management
 *
 * Based on the claude_source_code/bridge pattern.
 */

// Main exports
export {
  runBridgeLoop,
  parseArgs,
  type BridgeConfig,
  type ParsedArgs,
} from "./bridgeMain.js";

export { createBridgeApiClient, type BridgeApiClient, BridgeFatalError, isExpiredErrorType, isSuppressible403, validateBridgeId } from "./bridgeApi.js";

export { createBridgeLogger, type BridgeLogger, type BridgeConfig as LoggerBridgeConfig, type SessionActivity, type SpawnMode } from "./bridgeUI.js";

export { createSessionSpawner, type SessionSpawner, type SessionSpawnOpts, safeFilenameId, type PermissionRequest } from "./sessionRunner.js";

export { createCapacityWake, type CapacitySignal, type CapacityWake } from "./capacityWake.js";

export { createTokenRefreshScheduler, decodeJwtPayload, decodeJwtExpiry, type TokenRefreshScheduler } from "./jwtUtils.js";

export { getTrustedDeviceToken, enrollTrustedDevice, configureTrustedDevice, isTrustedDeviceEnabled, clearTrustedDeviceTokenCache } from "./trustedDevice.js";

export { getPollIntervalConfig, validatePollConfig, type PollIntervalConfig } from "./pollConfig.js";

export { decodeWorkSecret, buildSdkUrl, buildCCRv2SdkUrl, registerWorker, createCodeSession, fetchRemoteCredentials, sameSessionId, type WorkSecret, type RemoteCredentials } from "./workSecret.js";

export { toCompatSessionId, toInfraSessionId, isCseShimEnabled, setCseShimGate, type BridgeConfig as CompatBridgeConfig, type BackoffConfig, type PollIntervalConfig as CompatPollConfig } from "./sessionIdCompat.js";

export {
  formatDuration,
  truncateToWidth,
  buildBridgeConnectUrl,
  buildBridgeSessionUrl,
  getBridgeStatus,
  buildIdleFooterText,
  buildActiveFooterText,
  FAILED_FOOTER_TEXT,
  wrapWithOsc8Link,
  abbreviateActivity,
  timestamp,
  type BridgeStatusInfo,
  type StatusState,
} from "./bridgeStatusUtil.js";

export { initEnvLessBridgeCore, type EnvLessBridgeParams, type ReplBridgeHandle as EnvLessReplBridgeHandle, type BridgeState } from "./remoteBridgeCore.js";

export { initBridgeCore, type BridgeCoreParams, type ReplBridgeHandle, type BridgeState as ReplBridgeState } from "./replBridge.js";

// Types
export type {
  WorkData,
  WorkResponse,
  WorkSecret,
  SessionDoneStatus,
  SessionActivityType,
  SessionActivity,
  SpawnMode,
  BridgeWorkerType,
  BridgeConfig as FullBridgeConfig,
  PermissionResponseEvent,
  BridgeApiClient as FullBridgeApiClient,
  SessionHandle,
  SessionSpawnOpts as FullSessionSpawnOpts,
  SessionSpawner as FullSessionSpawner,
  BridgeLogger as FullBridgeLogger,
  PollIntervalConfig as FullPollIntervalConfig,
  BackoffConfig,
  DEFAULT_BACKOFF,
  DEFAULT_POLL_CONFIG,
  DEFAULT_SESSION_TIMEOUT_MS,
  TrustedDeviceConfig,
  RemoteCredentials as FullRemoteCredentials,
  CodeSessionCreateParams,
  CodeSession,
  EnvLessBridgeParams as FullEnvLessBridgeParams,
  ReplBridgeHandle as FullReplBridgeHandle,
  BridgeTransport,
  CapacitySignal as FullCapacitySignal,
  CapacityWake as FullCapacityWake,
  TokenRefreshScheduler as FullTokenRefreshScheduler,
  BridgePointer,
  BRIDGE_POINTER_TTL_MS,
  BridgeState as FullBridgeState,
  ParsedArgs as FullParsedArgs,
} from "./types.js";

// Constants
export {
  DEFAULT_SESSION_TIMEOUT_MS,
  BRIDGE_LOGIN_INSTRUCTION,
  BRIDGE_LOGIN_ERROR,
  REMOTE_CONTROL_DISCONNECTED_MSG,
  DEFAULT_BACKOFF,
  DEFAULT_POLL_CONFIG,
  BRIDGE_POINTER_TTL_MS,
} from "./types.js";

// Re-export error utilities
export { isConnectionError, isServerError } from "./bridgeMain.js";

// Transport exports
export { WebSocketTransport, createWebSocketTransport, type WebSocketTransportOptions } from "./transports/websocket.js";
export { SSETransport, createSSETransport, type SSETransportOptions } from "./transports/sse.js";
export type { BridgeTransport as Transport } from "./types.js";

// Convenience function for creating a new bridge configuration
export function createBridgeConfig(params: {
  dir: string;
  machineName: string;
  branch: string;
  gitRepoUrl?: string;
  maxSessions?: number;
  spawnMode?: SpawnMode;
  verbose?: boolean;
  sandbox?: boolean;
  apiBaseUrl?: string;
  sessionIngressUrl?: string;
}): BridgeConfig {
  return {
    dir: params.dir,
    machineName: params.machineName,
    branch: params.branch,
    gitRepoUrl: params.gitRepoUrl ?? null,
    maxSessions: params.maxSessions ?? 1,
    spawnMode: params.spawnMode ?? "single-session",
    verbose: params.verbose ?? false,
    sandbox: params.sandbox ?? false,
    bridgeId: `bridge-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    workerType: "pakalon_cli",
    environmentId: `env-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    apiBaseUrl: params.apiBaseUrl ?? "https://api.claude.ai",
    sessionIngressUrl: params.sessionIngressUrl ?? "https://api.claude.ai",
  };
}
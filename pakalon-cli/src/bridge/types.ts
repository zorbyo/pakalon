/**
 * Default per-session timeout (24 hours).
 */
export const DEFAULT_SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/**
 * Reusable login guidance appended to bridge auth errors.
 */
export const BRIDGE_LOGIN_INSTRUCTION =
  "Remote Control is only available with claude.ai subscriptions. Please use `/login` to sign in with your claude.ai account.";

/**
 * Full error printed when `pakalon remote-control` is run without auth.
 */
export const BRIDGE_LOGIN_ERROR =
  "Error: You must be logged in to use Remote Control.\n\n" +
  BRIDGE_LOGIN_INSTRUCTION;

/**
 * Shown when the user disconnects Remote Control.
 */
export const REMOTE_CONTROL_DISCONNECTED_MSG = "Remote Control disconnected.";

export type MemorySearchPayload = {
  query: string;
  user_id: string;
  top_k?: number;
};

export type MemorySearchResult = {
  memories: Array<{
    id: string;
    text: string;
    score?: number;
    metadata?: Record<string, unknown>;
  }>;
};

// --- Protocol types for the environments API ---

export type WorkData = {
  type: "session" | "healthcheck";
  id: string;
};

export type WorkResponse = {
  id: string;
  type: "work";
  environment_id: string;
  state: string;
  data: WorkData;
  secret: string; // base64url-encoded JSON
  created_at: string;
};

export type WorkSecret = {
  version: number;
  session_ingress_token: string;
  api_base_url: string;
  sources: Array<{
    type: string;
    git_info?: {
      type: string;
      repo: string;
      ref?: string;
      token?: string;
    };
  }>;
  auth: Array<{ type: string; token: string }>;
  claude_code_args?: Record<string, string> | null;
  mcp_config?: unknown | null;
  environment_variables?: Record<string, string> | null;
  use_code_sessions?: boolean;
};

export type SessionDoneStatus = "completed" | "failed" | "interrupted";

export type SessionActivityType = "tool_start" | "text" | "result" | "error";

export type SessionActivity = {
  type: SessionActivityType;
  summary: string;
  timestamp: number;
};

/**
 * How `pakalon remote-control` chooses session working directories.
 * - `single-session`: one session in cwd, bridge tears down when it ends
 * - `worktree`: persistent server, every session gets an isolated git worktree
 * - `same-dir`: persistent server, every session shares cwd
 */
export type SpawnMode = "single-session" | "worktree" | "same-dir";

/**
 * Well-known worker_type values this codebase produces.
 */
export type BridgeWorkerType = "pakalon_cli" | "pakalon_cli_assistant";

export type BridgeConfig = {
  dir: string;
  machineName: string;
  branch: string;
  gitRepoUrl: string | null;
  maxSessions: number;
  spawnMode: SpawnMode;
  verbose: boolean;
  sandbox: boolean;
  bridgeId: string;
  workerType: string;
  environmentId: string;
  reuseEnvironmentId?: string;
  apiBaseUrl: string;
  sessionIngressUrl: string;
  debugFile?: string;
  sessionTimeoutMs?: number;
};

// --- Dependency interfaces ---

export type PermissionResponseEvent = {
  type: "control_response";
  response: {
    subtype: "success";
    request_id: string;
    response: Record<string, unknown>;
  };
};

export type BridgeApiClient = {
  registerBridgeEnvironment(
    config: BridgeConfig
  ): Promise<{ environment_id: string; environment_secret: string }>;
  pollForWork(
    environmentId: string,
    environmentSecret: string,
    signal?: AbortSignal,
    reclaimOlderThanMs?: number
  ): Promise<WorkResponse | null>;
  acknowledgeWork(
    environmentId: string,
    workId: string,
    sessionToken: string
  ): Promise<void>;
  stopWork(
    environmentId: string,
    workId: string,
    force: boolean
  ): Promise<void>;
  deregisterEnvironment(environmentId: string): Promise<void>;
  sendPermissionResponseEvent(
    sessionId: string,
    event: PermissionResponseEvent,
    sessionToken: string
  ): Promise<void>;
  archiveSession(sessionId: string): Promise<void>;
  reconnectSession(
    environmentId: string,
    sessionId: string
  ): Promise<void>;
  heartbeatWork(
    environmentId: string,
    workId: string,
    sessionToken: string
  ): Promise<{ lease_extended: boolean; state: string }>;
};

export type SessionHandle = {
  sessionId: string;
  done: Promise<SessionDoneStatus>;
  kill(): void;
  forceKill(): void;
  activities: SessionActivity[];
  currentActivity: SessionActivity | null;
  accessToken: string;
  lastStderr: string[];
  writeStdin(data: string): void;
  updateAccessToken(token: string): void;
};

export type SessionSpawnOpts = {
  sessionId: string;
  sdkUrl: string;
  accessToken: string;
  useCcrV2?: boolean;
  workerEpoch?: number;
  onFirstUserMessage?: (text: string) => void;
};

export type SessionSpawner = {
  spawn(opts: SessionSpawnOpts, dir: string): SessionHandle;
};

export type BridgeLogger = {
  printBanner(config: BridgeConfig, environmentId: string): void;
  logSessionStart(sessionId: string, prompt: string): void;
  logSessionComplete(sessionId: string, durationMs: number): void;
  logSessionFailed(sessionId: string, error: string): void;
  logStatus(message: string): void;
  logVerbose(message: string): void;
  logError(message: string): void;
  logReconnected(disconnectedMs: number): void;
  updateIdleStatus(): void;
  updateReconnectingStatus(delayStr: string, elapsedStr: string): void;
  updateSessionStatus(
    sessionId: string,
    elapsed: string,
    activity: SessionActivity,
    trail: string[]
  ): void;
  clearStatus(): void;
  setRepoInfo(repoName: string, branch: string): void;
  setDebugLogPath(path: string): void;
  setAttached(sessionId: string): void;
  updateFailedStatus(error: string): void;
  toggleQr(): void;
  updateSessionCount(
    active: number,
    max: number,
    mode: SpawnMode
  ): void;
  setSpawnModeDisplay(mode: "same-dir" | "worktree" | null): void;
  addSession(sessionId: string, url: string): void;
  updateSessionActivity(
    sessionId: string,
    activity: SessionActivity
  ): void;
  setSessionTitle(sessionId: string, title: string): void;
  removeSession(sessionId: string): void;
  refreshDisplay(): void;
};

// --- Poll interval config ---

export type PollIntervalConfig = {
  poll_interval_ms_not_at_capacity: number;
  poll_interval_ms_at_capacity: number;
  non_exclusive_heartbeat_interval_ms: number;
  multisession_poll_interval_ms_not_at_capacity: number;
  multisession_poll_interval_ms_partial_capacity: number;
  multisession_poll_interval_ms_at_capacity: number;
  reclaim_older_than_ms: number;
  session_keepalive_interval_v2_ms: number;
};

export const DEFAULT_POLL_CONFIG: PollIntervalConfig = {
  poll_interval_ms_not_at_capacity: 5000,
  poll_interval_ms_at_capacity: 600_000,
  non_exclusive_heartbeat_interval_ms: 0,
  multisession_poll_interval_ms_not_at_capacity: 5000,
  multisession_poll_interval_ms_partial_capacity: 5000,
  multisession_poll_interval_ms_at_capacity: 600_000,
  reclaim_older_than_ms: 5000,
  session_keepalive_interval_v2_ms: 120_000,
};

// --- Backoff config ---

export type BackoffConfig = {
  connInitialMs: number;
  connCapMs: number;
  connGiveUpMs: number;
  generalInitialMs: number;
  generalCapMs: number;
  generalGiveUpMs: number;
  shutdownGraceMs?: number;
  stopWorkBaseDelayMs?: number;
};

export const DEFAULT_BACKOFF: BackoffConfig = {
  connInitialMs: 2_000,
  connCapMs: 120_000,
  connGiveUpMs: 600_000,
  generalInitialMs: 500,
  generalCapMs: 30_000,
  generalGiveUpMs: 600_000,
};

// --- Parsed CLI args ---

export type ParsedArgs = {
  verbose: boolean;
  sandbox: boolean;
  debugFile?: string;
  sessionTimeoutMs?: number;
  permissionMode?: string;
  name?: string;
  spawnMode: SpawnMode | undefined;
  capacity: number | undefined;
  createSessionInDir: boolean | undefined;
  sessionId?: string;
  continueSession: boolean;
  help: boolean;
  error?: string;
};

// --- Bridge state ---

export type BridgeState = "idle" | "attached" | "titled" | "reconnecting" | "failed";

// --- Trusted device ---

export type TrustedDeviceConfig = {
  enabled: boolean;
  deviceToken?: string;
  enrollmentEndpoint?: string;
};

// --- Session API types (v2) ---

export type RemoteCredentials = {
  worker_jwt: string;
  expires_in: number;
  api_base_url: string;
  worker_epoch: number;
};

export type CodeSessionCreateParams = {
  title: string;
  tags?: string[];
};

export type CodeSession = {
  id: string;
  status: string;
  title?: string;
  created_at: string;
};

// --- Env-less bridge params ---

export type EnvLessBridgeParams = {
  baseUrl: string;
  orgUUID: string;
  title: string;
  getAccessToken: () => string | undefined;
  onAuth401?: (
    staleAccessToken: string
  ) => Promise<boolean>;
  toSDKMessages: (messages: unknown[]) => unknown[];
  initialHistoryCap: number;
  initialMessages?: unknown[];
  onInboundMessage?: (msg: unknown) => void | Promise<void>;
  onUserMessage?: (text: string, sessionId: string) => boolean;
  onPermissionResponse?: (response: unknown) => void;
  onInterrupt?: () => void;
  onSetModel?: (model: string | undefined) => void;
  onSetMaxThinkingTokens?: (maxTokens: number | null) => void;
  onSetPermissionMode?: (mode: string) => { ok: true } | { ok: false; error: string };
  onStateChange?: (state: BridgeState, detail?: string) => void;
  outboundOnly?: boolean;
  tags?: string[];
};

// --- REPL bridge handle ---

export type ReplBridgeHandle = {
  bridgeSessionId: string;
  environmentId: string;
  sessionIngressUrl: string;
  writeMessages(messages: unknown[]): void;
  writeSdkMessages(messages: unknown[]): void;
  sendControlRequest(request: unknown): void;
  sendControlResponse(response: unknown): void;
  sendControlCancelRequest(requestId: string): void;
  sendResult(): void;
  teardown(): Promise<void>;
};

// --- Transport types ---

export type BridgeTransport = {
  write(message: unknown): Promise<void>;
  writeBatch(messages: unknown[]): Promise<void>;
  close(): void;
  isConnectedStatus(): boolean;
  getStateLabel(): string;
  setOnData(callback: (data: string) => void): void;
  setOnClose(callback: (closeCode?: number) => void): void;
  setOnConnect(callback: () => void): void;
  connect(): void;
  getLastSequenceNum(): number;
  readonly droppedBatchCount: number;
  reportState(state: string): void;
  reportMetadata(metadata: Record<string, unknown>): void;
  reportDelivery(
    eventId: string,
    status: "processing" | "processed"
  ): void;
  flush(): Promise<void>;
};

// --- Capacity wake ---

export type CapacitySignal = { signal: AbortSignal; cleanup: () => void };

export type CapacityWake = {
  signal(): CapacitySignal;
  wake(): void;
};

// --- Token refresh ---

export type TokenRefreshScheduler = {
  schedule(sessionId: string, token: string): void;
  scheduleFromExpiresIn(
    sessionId: string,
    expiresInSeconds: number
  ): void;
  cancel(sessionId: string): void;
  cancelAll(): void;
};

// --- Bridge pointer (crash recovery) ---

export type BridgePointer = {
  sessionId: string;
  environmentId: string;
  source: "standalone" | "repl";
};

export const BRIDGE_POINTER_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

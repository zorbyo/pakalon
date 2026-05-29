/**
 * Main bridge loop implementation.
 *
 * This is the core polling loop that:
 * 1. Registers the bridge environment
 * 2. Polls for work items
 * 3. Spawns sessions to handle work
 * 4. Manages session lifecycle
 * 5. Handles reconnection and recovery
 */

import { randomUUID } from "crypto";
import { hostname } from "os";
import { basename, join, resolve } from "path";
import { tmpdir } from "os";
import { sleep } from "@/utils/sleep.js";
import { errorMessage } from "@/utils/errors.js";
import { logError } from "@/utils/logger.js";
import {
  createBridgeApiClient,
  BridgeFatalError,
  isExpiredErrorType,
  isSuppressible403,
  validateBridgeId,
} from "./bridgeApi.js";
import { formatDuration } from "./bridgeStatusUtil.js";
import { createBridgeLogger } from "./bridgeUI.js";
import { createCapacityWake } from "./capacityWake.js";
import { createTokenRefreshScheduler } from "./jwtUtils.js";
import { getPollIntervalConfig } from "./pollConfig.js";
import { toCompatSessionId, toInfraSessionId } from "./sessionIdCompat.js";
import { createSessionSpawner, safeFilenameId } from "./sessionRunner.js";
import { getTrustedDeviceToken } from "./trustedDevice.js";
import {
  decodeWorkSecret,
  buildCCRv2SdkUrl,
  buildSdkUrl,
  registerWorker,
  sameSessionId,
} from "./workSecret.js";
import { createAgentWorktree, removeAgentWorktree } from "@/utils/worktree.js";
import type {
  BridgeConfig,
  BridgeLogger,
  SessionActivity,
  SessionDoneStatus,
  SessionHandle,
  SessionSpawner,
  SessionSpawnOpts,
  SpawnMode,
  WorkResponse,
} from "./types.js";
import { DEFAULT_BACKOFF, DEFAULT_SESSION_TIMEOUT_MS } from "./types.js";

export type { BridgeConfig, BridgeLogger, ParsedArgs } from "./types.js";

const STATUS_UPDATE_INTERVAL_MS = 1_000;
const SPAWN_SESSIONS_DEFAULT = 32;

const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

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

export function isConnectionError(err: unknown): boolean {
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    typeof err.code === "string" &&
    CONNECTION_ERROR_CODES.has(err.code)
  ) {
    return true;
  }
  return false;
}

export function isServerError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "code" in err &&
    typeof err.code === "string" &&
    err.code === "ERR_BAD_RESPONSE"
  );
}

function addJitter(ms: number): number {
  return Math.max(0, ms + ms * 0.25 * (2 * Math.random() - 1));
}

function formatDelay(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/**
 * Returns the threshold for detecting system sleep/wake in the poll loop.
 * Must exceed the max backoff cap — otherwise normal backoff delays trigger
 * false sleep detection.
 */
function pollSleepDetectionThresholdMs(backoff: BackoffConfig): number {
  return backoff.connCapMs * 2;
}

function safeSpawn(
  spawner: SessionSpawner,
  opts: SessionSpawnOpts,
  dir: string
): SessionHandle | string {
  try {
    return spawner.spawn(opts, dir);
  } catch (err) {
    const errMsg = errorMessage(err);
    logError(new Error(`Session spawn failed: ${errMsg}`));
    return errMsg;
  }
}

export async function runBridgeLoop(
  config: BridgeConfig,
  environmentId: string,
  environmentSecret: string,
  api: ReturnType<typeof createBridgeApiClient>,
  spawner: SessionSpawner,
  logger: BridgeLogger,
  signal: AbortSignal,
  backoffConfig = DEFAULT_BACKOFF,
  initialSessionId?: string,
  getAccessToken?: () => string | undefined | Promise<string | undefined>
): Promise<void> {
  const controller = new AbortController();
  if (signal.aborted) {
    controller.abort();
  } else {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  const loopSignal = controller.signal;

  const activeSessions = new Map<string, SessionHandle>();
  const sessionStartTimes = new Map<string, number>();
  const sessionWorkIds = new Map<string, string>();
  const sessionCompatIds = new Map<string, string>();
  const sessionIngressTokens = new Map<string, string>();
  const sessionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const completedWorkIds = new Set<string>();
  const timedOutSessions = new Set<string>();
  const titledSessions = new Set<string>();
  const sessionWorktrees = new Map<
    string,
    {
      worktreePath: string;
      worktreeBranch?: string;
      gitRoot?: string;
      hookBased?: boolean;
    }
  >();
  const capacityWake = createCapacityWake(loopSignal);

  const v2Sessions = new Set<string>();

  /**
   * Heartbeat all active work items.
   * Returns 'ok' if at least one heartbeat succeeded, 'auth_failed' if any
   * got a 401/403 (JWT expired), or 'failed' if all failed.
   */
  async function heartbeatActiveWorkItems(): Promise<
    "ok" | "auth_failed" | "fatal" | "failed"
  > {
    let anySuccess = false;
    let anyFatal = false;
    const authFailedSessions: string[] = [];

    for (const [sessionId] of activeSessions) {
      const workId = sessionWorkIds.get(sessionId);
      const ingressToken = sessionIngressTokens.get(sessionId);
      if (!workId || !ingressToken) {
        continue;
      }
      try {
        await api.heartbeatWork(environmentId, workId, ingressToken);
        anySuccess = true;
      } catch (err) {
        if (err instanceof BridgeFatalError) {
          if (err.status === 401 || err.status === 403) {
            authFailedSessions.push(sessionId);
          } else {
            anyFatal = true;
          }
        }
      }
    }

    for (const sessionId of authFailedSessions) {
      logger.logVerbose(
        `Session ${sessionId} token expired — re-queuing via bridge/reconnect`
      );
      try {
        await api.reconnectSession(environmentId, sessionId);
      } catch {
        logger.logError(`Failed to refresh session ${sessionId} token`);
      }
    }

    if (anyFatal) {
      return "fatal";
    }
    if (authFailedSessions.length > 0) {
      return "auth_failed";
    }
    return anySuccess ? "ok" : "failed";
  }

  const tokenRefresh =
    getAccessToken && createTokenRefreshScheduler
      ? createTokenRefreshScheduler({
          getAccessToken,
          onRefresh: (sessionId, oauthToken) => {
            const handle = activeSessions.get(sessionId);
            if (!handle) return;
            if (v2Sessions.has(sessionId)) {
              void api
                .reconnectSession(environmentId, sessionId)
                .catch(() => {});
            } else {
              handle.updateAccessToken(oauthToken);
            }
          },
          label: "bridge",
        })
      : null;

  const loopStartTime = Date.now();
  const pendingCleanups = new Set<Promise<unknown>>();
  function trackCleanup(p: Promise<unknown>): void {
    pendingCleanups.add(p);
    void p.finally(() => pendingCleanups.delete(p));
  }

  let connBackoff = 0;
  let generalBackoff = 0;
  let connErrorStart: number | null = null;
  let generalErrorStart: number | null = null;
  let lastPollErrorTime: number | null = null;
  let statusUpdateTimer: ReturnType<typeof setInterval> | null = null;
  let fatalExit = false;

  logger.printBanner(config, environmentId);
  logger.updateSessionCount(0, config.maxSessions, config.spawnMode);

  if (initialSessionId) {
    logger.setAttached(initialSessionId);
  }

  function updateStatusDisplay(): void {
    logger.updateSessionCount(
      activeSessions.size,
      config.maxSessions,
      config.spawnMode
    );

    for (const [sid, handle] of activeSessions) {
      const act = handle.currentActivity;
      if (act) {
        logger.updateSessionActivity(
          sessionCompatIds.get(sid) ?? sid,
          act
        );
      }
    }

    if (activeSessions.size === 0) {
      logger.updateIdleStatus();
      return;
    }

    const [sessionId, handle] = [...activeSessions.entries()].pop()!;
    const startTime = sessionStartTimes.get(sessionId);
    if (!startTime) return;

    const activity = handle.currentActivity;
    if (!activity || activity.type === "result" || activity.type === "error") {
      if (config.maxSessions > 1) logger.refreshDisplay();
      return;
    }

    const elapsed = formatDuration(Date.now() - startTime);
    const trail = handle.activities
      .filter((a) => a.type === "tool_start")
      .slice(-5)
      .map((a) => a.summary);

    logger.updateSessionStatus(sessionId, elapsed, activity, trail);
  }

  function startStatusUpdates(): void {
    stopStatusUpdates();
    updateStatusDisplay();
    statusUpdateTimer = setInterval(updateStatusDisplay, STATUS_UPDATE_INTERVAL_MS);
  }

  function stopStatusUpdates(): void {
    if (statusUpdateTimer) {
      clearInterval(statusUpdateTimer);
      statusUpdateTimer = null;
    }
  }

  function onSessionDone(
    sessionId: string,
    startTime: number,
    handle: SessionHandle
  ): (status: SessionDoneStatus) => void {
    return (rawStatus: SessionDoneStatus): void => {
      const workId = sessionWorkIds.get(sessionId);
      activeSessions.delete(sessionId);
      sessionStartTimes.delete(sessionId);
      sessionWorkIds.delete(sessionId);
      sessionIngressTokens.delete(sessionId);
      const compatId = sessionCompatIds.get(sessionId) ?? sessionId;
      sessionCompatIds.delete(sessionId);
      logger.removeSession(compatId);
      titledSessions.delete(compatId);
      v2Sessions.delete(sessionId);

      const timer = sessionTimers.get(sessionId);
      if (timer) {
        clearTimeout(timer);
        sessionTimers.delete(sessionId);
      }

      tokenRefresh?.cancel(sessionId);
      capacityWake.wake();

      const wasTimedOut = timedOutSessions.delete(sessionId);
      const status: SessionDoneStatus =
        wasTimedOut && rawStatus === "interrupted" ? "failed" : rawStatus;
      const durationMs = Date.now() - startTime;

      logger.clearStatus();
      stopStatusUpdates();

      const stderrSummary =
        handle.lastStderr.length > 0
          ? handle.lastStderr.join("\n")
          : undefined;
      let failureMessage: string | undefined;

      switch (status) {
        case "completed":
          logger.logSessionComplete(sessionId, durationMs);
          break;
        case "failed":
          if (!wasTimedOut && !loopSignal.aborted) {
            failureMessage = stderrSummary ?? "Process exited with error";
            logger.logSessionFailed(sessionId, failureMessage);
            logError(new Error(`Bridge session failed: ${failureMessage}`));
          }
          break;
        case "interrupted":
          logger.logVerbose(`Session ${sessionId} interrupted`);
          break;
      }

if (status !== "interrupted" && workId) {
    trackCleanup(
      stopWorkWithRetry(
        api,
        environmentId,
        workId,
        logger,
        backoffConfig.stopWorkBaseDelayMs
      )
    );
    completedWorkIds.add(workId);
  }

  const wt = sessionWorktrees.get(sessionId);
  if (wt) {
    sessionWorktrees.delete(sessionId);
    trackCleanup(
      removeAgentWorktree(
        wt.worktreePath,
        wt.worktreeBranch,
        wt.gitRoot,
        wt.hookBased
      ).catch(() =>
        logger.logVerbose(`Failed to remove worktree ${wt.worktreePath}`)
      )
    );
  }

  if (status !== "interrupted" && !loopSignal.aborted) {
        if (config.spawnMode !== "single-session") {
          trackCleanup(
            api
              .archiveSession(compatId)
              .catch(() =>
                logger.logVerbose(`Failed to archive session ${sessionId}`)
              )
          );
        } else {
          controller.abort();
          return;
        }
      }

      if (!loopSignal.aborted) {
        startStatusUpdates();
      }
    };
  }

  if (!initialSessionId) {
    startStatusUpdates();
  }

while (!loopSignal.aborted) {
  const pollConfig = getPollIntervalConfig();

  try {
    const work = await api.pollForWork(
      environmentId,
      environmentSecret,
      loopSignal,
      pollConfig.reclaim_older_than_ms
    );

    connBackoff = 0;
    generalBackoff = 0;
    connErrorStart = null;
    generalErrorStart = null;
    lastPollErrorTime = null;

    const atCapacityBeforeSwitch = activeSessions.size >= config.maxSessions;

    if (!work) {
      const atCap = atCapacityBeforeSwitch;
      if (atCap) {
          const cap = capacityWake.signal();
          if (pollConfig.non_exclusive_heartbeat_interval_ms > 0) {
            await sleep(
              pollConfig.non_exclusive_heartbeat_interval_ms,
              cap.signal
            );
          } else if (pollConfig.multisession_poll_interval_ms_at_capacity > 0) {
            await sleep(
              pollConfig.multisession_poll_interval_ms_at_capacity,
              cap.signal
            );
          }
          cap.cleanup();
        } else {
          const interval =
            activeSessions.size > 0
              ? pollConfig.multisession_poll_interval_ms_partial_capacity
              : pollConfig.multisession_poll_interval_ms_not_at_capacity;
          await sleep(interval, loopSignal);
        }
        continue;
      }

if (completedWorkIds.has(work.id)) {
  if (atCapacityBeforeSwitch) {
          const cap = capacityWake.signal();
          if (pollConfig.non_exclusive_heartbeat_interval_ms > 0) {
            await sleep(
              pollConfig.non_exclusive_heartbeat_interval_ms,
              cap.signal
            );
          }
          cap.cleanup();
        } else {
          await sleep(1000, loopSignal);
        }
        continue;
      }

      let secret;
      try {
        secret = decodeWorkSecret(work.secret);
      } catch {
        completedWorkIds.add(work.id);
        continue;
      }

      const ackWork = async (): Promise<void> => {
        try {
          await api.acknowledgeWork(
            environmentId,
            work.id,
            secret.session_ingress_token
          );
        } catch {
          // Ack failures non-fatal
        }
      };

      switch (work.data.type) {
        case "healthcheck":
          await ackWork();
          break;

        case "session": {
          const sessionId = work.data.id;
          try {
            validateBridgeId(sessionId, "session_id");
          } catch {
            await ackWork();
            logger.logError(`Invalid session_id received: ${sessionId}`);
            break;
          }

          const existingHandle = activeSessions.get(sessionId);
          if (existingHandle) {
            existingHandle.updateAccessToken(secret.session_ingress_token);
            sessionIngressTokens.set(sessionId, secret.session_ingress_token);
            sessionWorkIds.set(sessionId, work.id);
            tokenRefresh?.schedule(sessionId, secret.session_ingress_token);
            await ackWork();
            break;
          }

          if (activeSessions.size >= config.maxSessions) {
            break;
          }

          await ackWork();
          const spawnStartTime = Date.now();

          let sdkUrl: string;
          let useCcrV2 = false;
          let workerEpoch: number | undefined;

          if (secret.use_code_sessions === true) {
            sdkUrl = buildCCRv2SdkUrl(config.apiBaseUrl, sessionId);
            try {
              workerEpoch = await registerWorker(sdkUrl, secret.session_ingress_token);
              useCcrV2 = true;
            } catch {
              break;
            }
          } else {
            sdkUrl = buildSdkUrl(config.sessionIngressUrl, sessionId);
          }

          const spawnResult = safeSpawn(spawner, {
            sessionId,
            sdkUrl,
            accessToken: secret.session_ingress_token,
            useCcrV2,
            workerEpoch,
            onFirstUserMessage: (text) => {
              if (titledSessions.has(sessionId)) return;
              titledSessions.add(sessionId);
              const title = deriveSessionTitle(text);
              logger.setSessionTitle(sessionId, title);
            },
          }, config.dir);

          if (typeof spawnResult === "string") {
            logger.logError(`Failed to spawn session ${sessionId}: ${spawnResult}`);
            completedWorkIds.add(work.id);
            break;
          }

          const handle = spawnResult;
          const compatSessionId = toCompatSessionId(sessionId);

          activeSessions.set(sessionId, handle);
          sessionWorkIds.set(sessionId, work.id);
          sessionIngressTokens.set(sessionId, secret.session_ingress_token);
          sessionCompatIds.set(sessionId, compatSessionId);

          const startTime = Date.now();
          sessionStartTimes.set(sessionId, startTime);

          logger.logSessionStart(sessionId, `Session ${sessionId}`);
          logger.addSession(
            compatSessionId,
            `${config.sessionIngressUrl}/sessions/${compatSessionId}`
          );

          startStatusUpdates();
          logger.setAttached(compatSessionId);

if (useCcrV2) {
    v2Sessions.add(sessionId);
  }
  tokenRefresh?.schedule(sessionId, secret.session_ingress_token);

  const timeoutMs = config.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
  if (timeoutMs > 0) {
    const timer = setTimeout(
      onSessionTimeout,
      timeoutMs,
      sessionId,
      timeoutMs,
      logger,
      timedOutSessions,
      handle
    );
    sessionTimers.set(sessionId, timer);
  }

  void handle.done.then(onSessionDone(sessionId, startTime, handle));
          break;
        }

        default:
          await ackWork();
          break;
      }

      if (activeSessions.size >= config.maxSessions) {
        const cap = capacityWake.signal();
        if (pollConfig.non_exclusive_heartbeat_interval_ms > 0) {
          await sleep(
            pollConfig.non_exclusive_heartbeat_interval_ms,
            cap.signal
          );
        } else if (pollConfig.multisession_poll_interval_ms_at_capacity > 0) {
          await sleep(
            pollConfig.multisession_poll_interval_ms_at_capacity,
            cap.signal
          );
        }
        cap.cleanup();
      }
    } catch (err) {
      if (loopSignal.aborted) break;

      if (err instanceof BridgeFatalError) {
        fatalExit = true;
        if (isExpiredErrorType(err.errorType)) {
          logger.logStatus(err.message);
        } else if (!isSuppressible403(err)) {
          logger.logError(err.message);
          logError(err);
        }
        break;
      }

      const errMsg = errorMessage(err);

if (isConnectionError(err) || isServerError(err)) {
    const now = Date.now();

    if (
      lastPollErrorTime !== null &&
      now - lastPollErrorTime > pollSleepDetectionThresholdMs(backoffConfig)
    ) {
      connErrorStart = null;
      connBackoff = 0;
      generalErrorStart = null;
      generalBackoff = 0;
    }
        lastPollErrorTime = now;

        if (!connErrorStart) connErrorStart = now;
        const elapsed = now - connErrorStart;

        if (elapsed >= backoffConfig.connGiveUpMs) {
          logger.logError(
            `Server unreachable for ${Math.round(elapsed / 60_000)} minutes, giving up.`
          );
          fatalExit = true;
          break;
        }

        generalErrorStart = null;
        generalBackoff = 0;

connBackoff = connBackoff
  ? Math.min(connBackoff * 2, backoffConfig.connCapMs)
  : backoffConfig.connInitialMs;
const delay = addJitter(connBackoff);

logger.updateReconnectingStatus(
  formatDelay(delay),
  formatDuration(elapsed)
);

if (getPollIntervalConfig().non_exclusive_heartbeat_interval_ms > 0) {
  await heartbeatActiveWorkItems();
}

await sleep(delay, loopSignal);
} else {
    const now = Date.now();

    if (
      lastPollErrorTime !== null &&
      now - lastPollErrorTime > pollSleepDetectionThresholdMs(backoffConfig)
    ) {
      generalErrorStart = null;
      generalBackoff = 0;
    }
        lastPollErrorTime = now;

        if (!generalErrorStart) generalErrorStart = now;
        const elapsed = now - generalErrorStart;

        if (elapsed >= backoffConfig.generalGiveUpMs) {
          logger.logError(
            `Persistent errors for ${Math.round(elapsed / 60_000)} minutes, giving up.`
          );
          fatalExit = true;
          break;
        }

connErrorStart = null;
connBackoff = 0;

generalBackoff = generalBackoff
  ? Math.min(generalBackoff * 2, backoffConfig.generalCapMs)
  : backoffConfig.generalInitialMs;
const delay = addJitter(generalBackoff);

logger.updateReconnectingStatus(
  formatDelay(delay),
  formatDuration(elapsed)
);

if (getPollIntervalConfig().non_exclusive_heartbeat_interval_ms > 0) {
  await heartbeatActiveWorkItems();
}

await sleep(delay, loopSignal);
      }
    }
  }

  stopStatusUpdates();
  logger.clearStatus();

  if (activeSessions.size > 0) {
    logger.logStatus(`Shutting down ${activeSessions.size} active session(s)…`);

    const shutdownWorkIds = new Map(sessionWorkIds);

    for (const [, handle] of activeSessions) {
      handle.kill();
    }

    const timeout = new AbortController();
    await Promise.race([
      Promise.allSettled([...activeSessions.values()].map((h) => h.done)),
      sleep(backoffConfig.shutdownGraceMs ?? 30_000, timeout.signal),
    ]);
    timeout.abort();

    for (const [, handle] of activeSessions) {
      handle.forceKill();
    }

    for (const timer of sessionTimers.values()) {
      clearTimeout(timer);
    }
    sessionTimers.clear();
    tokenRefresh?.cancelAll();
  }

  if (pendingCleanups.size > 0) {
    await Promise.allSettled([...pendingCleanups]);
  }

  const sessionsToArchive = new Set(activeSessions.keys());
  if (initialSessionId) {
    sessionsToArchive.add(initialSessionId);
  }

  if (sessionsToArchive.size > 0) {
    await Promise.allSettled(
      [...sessionsToArchive].map((sessionId) =>
        api
          .archiveSession(sessionCompatIds.get(sessionId) ?? sessionId)
          .catch(() =>
            logger.logVerbose(`Failed to archive session ${sessionId}`)
          )
      )
    );
  }

  try {
    await api.deregisterEnvironment(environmentId);
  } catch {
    logger.logVerbose("Failed to deregister environment");
  }
}

async function stopWorkWithRetry(
  api: ReturnType<typeof createBridgeApiClient>,
  environmentId: string,
  workId: string,
  logger: BridgeLogger,
  baseDelayMs = 1000
): Promise<void> {
  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await api.stopWork(environmentId, workId, false);
      return;
    } catch (err) {
      if (err instanceof BridgeFatalError) {
        if (isSuppressible403(err)) {
          // Suppressed
        } else {
          logger.logError(`Failed to stop work ${workId}: ${err.message}`);
        }
        return;
      }

      if (attempt < MAX_ATTEMPTS) {
        const delay = addJitter(baseDelayMs * Math.pow(2, attempt - 1));
        await sleep(delay);
      }
    }
  }
}

function onSessionTimeout(
  sessionId: string,
  timeoutMs: number,
  logger: BridgeLogger,
  timedOutSessions: Set<string>,
  handle: SessionHandle
): void {
  logger.logSessionFailed(
    sessionId,
    `Session timed out after ${formatDuration(timeoutMs)}`
  );
  timedOutSessions.add(sessionId);
  handle.kill();
}

const TITLE_MAX_LEN = 80;

function deriveSessionTitle(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return truncateToWidth(flat, TITLE_MAX_LEN);
}

function truncateToWidth(text: string, width: number): string {
  if (text.length <= width) return text;
  return text.slice(0, width - 3) + "...";
}

export function parseArgs(args: string[]): {
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
} {
  let verbose = false;
  let sandbox = false;
  let debugFile: string | undefined;
  let sessionTimeoutMs: number | undefined;
  let permissionMode: string | undefined;
  let name: string | undefined;
  let help = false;
  let spawnMode: SpawnMode | undefined;
  let capacity: number | undefined;
  let createSessionInDir: boolean | undefined;
  let sessionId: string | undefined;
  let continueSession = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    } else if (arg === "--sandbox") {
      sandbox = true;
    } else if (arg === "--debug-file" && i + 1 < args.length) {
      debugFile = resolve(args[++i]!);
    } else if (arg.startsWith("--debug-file=")) {
      debugFile = resolve(arg.slice("--debug-file=".length));
    } else if (arg === "--session-timeout" && i + 1 < args.length) {
      sessionTimeoutMs = parseInt(args[++i]!, 10) * 1000;
    } else if (arg.startsWith("--session-timeout=")) {
      sessionTimeoutMs = parseInt(arg.slice("--session-timeout=".length), 10) * 1000;
    } else if (arg === "--permission-mode" && i + 1 < args.length) {
      permissionMode = args[++i]!;
    } else if (arg === "--name" && i + 1 < args.length) {
      name = args[++i]!;
    } else if (arg === "--spawn" && i + 1 < args.length) {
      const v = args[++i]!;
      if (v === "session") spawnMode = "single-session";
      else if (v === "same-dir" || v === "worktree") spawnMode = v;
    } else if (arg.startsWith("--spawn=")) {
      const v = arg.slice("--spawn=".length);
      if (v === "session") spawnMode = "single-session";
      else if (v === "same-dir" || v === "worktree") spawnMode = v;
    } else if (arg === "--capacity" && i + 1 < args.length) {
      capacity = parseInt(args[++i]!, 10);
    } else if (arg.startsWith("--capacity=")) {
      capacity = parseInt(arg.slice("--capacity=".length), 10);
    } else if (arg === "--continue" || arg === "-c") {
      continueSession = true;
    } else if (arg === "--session-id" && i + 1 < args.length) {
      sessionId = args[++i]!;
    } else {
      return { verbose, sandbox, debugFile, sessionTimeoutMs, permissionMode, name, spawnMode, capacity, createSessionInDir, sessionId, continueSession, help, error: `Unknown argument: ${arg}` };
    }
  }

  if (spawnMode === "single-session" && capacity !== undefined) {
    return { verbose, sandbox, debugFile, sessionTimeoutMs, permissionMode, name, spawnMode, capacity, createSessionInDir, sessionId, continueSession, help, error: "--capacity cannot be used with --spawn=session" };
  }

  return { verbose, sandbox, debugFile, sessionTimeoutMs, permissionMode, name, spawnMode, capacity, createSessionInDir, sessionId, continueSession, help };
}
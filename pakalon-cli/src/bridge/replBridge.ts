/**
 * REPL bridge implementation.
 *
 * This is the in-process bridge for when the CLI is running
 * and Remote Control is enabled. It connects the local REPL
 * session to the remote claude.ai/code interface.
 */

import { randomUUID } from "crypto";
import { createBridgeApiClient, BridgeFatalError } from "./bridgeApi.js";
import type {
  BridgeConfig,
  BridgeState,
  PollIntervalConfig,
  ReplBridgeHandle,
} from "./types.js";
import { createCapacityWake } from "./capacityWake.js";
import { sameSessionId, toCompatSessionId, toInfraSessionId } from "./sessionIdCompat.js";
import { getTrustedDeviceToken } from "./trustedDevice.js";
import { decodeWorkSecret, buildSdkUrl, buildCCRv2SdkUrl, registerWorker } from "./workSecret.js";
import type { BridgeTransport } from "./types.js";

const POLL_ERROR_INITIAL_DELAY_MS = 2_000;
const POLL_ERROR_MAX_DELAY_MS = 60_000;
const POLL_ERROR_GIVE_UP_MS = 15 * 60 * 1000;

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

export type BridgeState = "ready" | "connected" | "reconnecting" | "failed";

export type BridgeCoreParams = {
  dir: string;
  machineName: string;
  branch: string;
  gitRepoUrl: string | null;
  title: string;
  baseUrl: string;
  sessionIngressUrl: string;
  workerType: string;
  getAccessToken: () => string | undefined;
  createSession: (opts: {
    environmentId: string;
    title: string;
    gitRepoUrl: string | null;
    branch: string;
    signal: AbortSignal;
  }) => Promise<string | null>;
  archiveSession: (sessionId: string) => Promise<void>;
  getCurrentTitle?: () => string;
  toSDKMessages?: (messages: unknown[]) => unknown[];
  onAuth401?: (staleAccessToken: string) => Promise<boolean>;
  getPollIntervalConfig?: () => PollIntervalConfig;
  initialHistoryCap?: number;
  initialMessages?: unknown[];
  previouslyFlushedUUIDs?: Set<string>;
  onInboundMessage?: (msg: unknown) => void;
  onPermissionResponse?: (response: unknown) => void;
  onInterrupt?: () => void;
  onSetModel?: (model: string | undefined) => void;
  onSetMaxThinkingTokens?: (maxTokens: number | null) => void;
  onSetPermissionMode?: (mode: string) => { ok: true } | { ok: false; error: string };
  onStateChange?: (state: BridgeState, detail?: string) => void;
  onUserMessage?: (text: string, sessionId: string) => boolean;
  perpetual?: boolean;
  initialSSESequenceNum?: number;
};

export async function initBridgeCore(
  params: BridgeCoreParams
): Promise<ReplBridgeHandle | null> {
  const {
    dir,
    machineName,
    branch,
    gitRepoUrl,
    title,
    baseUrl,
    sessionIngressUrl,
    workerType,
    getAccessToken,
    createSession,
    archiveSession,
    getCurrentTitle = () => title,
    toSDKMessages = () => [],
    onAuth401,
    getPollIntervalConfig,
    initialHistoryCap = 200,
    initialMessages,
    previouslyFlushedUUIDs,
    onInboundMessage,
    onPermissionResponse,
    onInterrupt,
    onSetModel,
    onSetMaxThinkingTokens,
    onSetPermissionMode,
    onStateChange,
    onUserMessage,
    perpetual,
    initialSSESequenceNum = 0,
  } = params;

  const api = createBridgeApiClient({
    baseUrl,
    getAccessToken,
    runnerVersion: "1.0.0",
    onAuth401,
    getTrustedDeviceToken,
  });

  const bridgeConfig: BridgeConfig = {
    dir,
    machineName,
    branch,
    gitRepoUrl,
    maxSessions: 1,
    spawnMode: "single-session",
    verbose: false,
    sandbox: false,
    bridgeId: randomUUID(),
    workerType,
    environmentId: randomUUID(),
    apiBaseUrl: baseUrl,
    sessionIngressUrl,
  };

  let environmentId: string;
  let environmentSecret: string;

  try {
    const reg = await api.registerBridgeEnvironment(bridgeConfig);
    environmentId = reg.environment_id;
    environmentSecret = reg.environment_secret;
  } catch (err) {
    onStateChange?.("failed", String(err));
    return null;
  }

  let currentSessionId: string;
  const createdSessionId = await createSession({
    environmentId,
    title,
    gitRepoUrl,
    branch,
    signal: AbortSignal.timeout(15_000),
  });

  if (!createdSessionId) {
    await api.deregisterEnvironment(environmentId).catch(() => {});
    onStateChange?.("failed", "Session creation failed");
    return null;
  }

  currentSessionId = createdSessionId;

  const initialMessageUUIDs = new Set<string>();
  if (initialMessages) {
    for (const msg of initialMessages as { uuid: string }[]) {
      initialMessageUUIDs.add(msg.uuid);
    }
  }

  const recentPostedUUIDs = new Set<string>();
  for (const uuid of initialMessageUUIDs) {
    recentPostedUUIDs.add(uuid);
  }

  const recentInboundUUIDs = new Set<string>();

  const pollController = new AbortController();
  let transport: BridgeTransport | null = null;
  let lastTransportSequenceNum = initialSSESequenceNum;
  let currentWorkId: string | null = null;
  let currentIngressToken: string | null = null;
  const capacityWake = createCapacityWake(pollController.signal);
  let userMessageCallbackDone = !onUserMessage;

  const MAX_ENVIRONMENT_RECREATIONS = 3;
  let environmentRecreations = 0;
  let reconnectPromise: Promise<boolean> | null = null;

  async function reconnectEnvironmentWithSession(): Promise<boolean> {
    if (reconnectPromise) {
      return reconnectPromise;
    }
    reconnectPromise = doReconnect();
    try {
      return await reconnectPromise;
    } finally {
      reconnectPromise = null;
    }
  }

  async function doReconnect(): Promise<boolean> {
    environmentRecreations++;

    if (environmentRecreations > MAX_ENVIRONMENT_RECREATIONS) {
      return false;
    }

    if (transport) {
      const seq = transport.getLastSequenceNum();
      if (seq > lastTransportSequenceNum) {
        lastTransportSequenceNum = seq;
      }
      transport.close();
      transport = null;
    }

    // Strategy: re-register and reconnect
    bridgeConfig.reuseEnvironmentId = environmentId;

    try {
      const reg = await api.registerBridgeEnvironment(bridgeConfig);
      environmentId = reg.environment_id;
      environmentSecret = reg.environment_secret;
    } catch {
      bridgeConfig.reuseEnvironmentId = undefined;
      return false;
    }

    bridgeConfig.reuseEnvironmentId = undefined;

    if (pollController.signal.aborted) {
      return false;
    }

    const currentTitle = getCurrentTitle();
    const newSessionId = await createSession({
      environmentId,
      title: currentTitle,
      gitRepoUrl,
      branch,
      signal: AbortSignal.timeout(15_000),
    });

    if (!newSessionId) {
      return false;
    }

    currentSessionId = newSessionId;
    lastTransportSequenceNum = 0;
    recentInboundUUIDs.clear();
    userMessageCallbackDone = !onUserMessage;

    return true;
  }

  function getOAuthToken(): string | undefined {
    return getAccessToken();
  }

  function handleTransportPermanentClose(closeCode: number | undefined): void {
    if (transport) {
      const closedSeq = transport.getLastSequenceNum();
      if (closedSeq > lastTransportSequenceNum) {
        lastTransportSequenceNum = closedSeq;
      }
      transport = null;
    }

    if (closeCode === 1000) {
      onStateChange?.("failed", "session ended");
      pollController.abort();
      return;
    }

    onStateChange?.(
      "reconnecting",
      `Remote Control connection lost (code ${closeCode})`
    );

    void reconnectEnvironmentWithSession().then((success) => {
      if (!success && !pollController.signal.aborted) {
        onStateChange?.("failed", "reconnection failed");
      }
    });
  }

  async function teardown(): Promise<void> {
    pollController.abort();

    if (transport) {
      transport.reportState("idle");
      transport.close();
      transport = null;
    }

    if (currentWorkId) {
      await api.stopWork(environmentId, currentWorkId, true).catch(() => {});
    }

    await archiveSession(currentSessionId);
    await api.deregisterEnvironment(environmentId).catch(() => {});
  }

  return {
    bridgeSessionId: currentSessionId,
    environmentId,
    sessionIngressUrl,

    writeMessages(messages) {
      const filtered = (messages as { uuid?: string; type: string }[]).filter(
        (m) =>
          !initialMessageUUIDs.has(m.uuid ?? "") &&
          !recentPostedUUIDs.has(m.uuid ?? "") &&
          (m.type === "user" ||
            m.type === "assistant" ||
            (m.type === "system" && (m as { subtype?: string }).subtype === "local_command"))
      );

      if (filtered.length === 0) return;

      if (!userMessageCallbackDone && onUserMessage) {
        for (const m of filtered) {
          const text = (m as { message?: { content?: string } }).message?.content as string | undefined;
          if (text && onUserMessage(text, currentSessionId)) {
            userMessageCallbackDone = true;
            break;
          }
        }
      }

      for (const msg of filtered) {
        if (msg.uuid) recentPostedUUIDs.add(msg.uuid);
      }

      const events = (toSDKMessages(filtered) as { session_id?: string }[]).map(
        (m) => ({ ...m, session_id: currentSessionId })
      );

      if (filtered.some((m) => m.type === "user")) {
        transport?.reportState("running");
      }

      void transport?.writeBatch(events);
    },

    writeSdkMessages(messages) {
      const filtered = (messages as { uuid?: string }[]).filter(
        (m) => !m.uuid || !recentPostedUUIDs.has(m.uuid)
      );

      if (filtered.length === 0) return;

      for (const msg of filtered) {
        if (msg.uuid) recentPostedUUIDs.add(msg.uuid);
      }

      const events = (filtered as { session_id?: string }[]).map((m) => ({
        ...m,
        session_id: currentSessionId,
      }));

      void transport?.writeBatch(events);
    },

    sendControlRequest(request) {
      const event = { ...request, session_id: currentSessionId };
      if ((request as { request?: { subtype?: string } }).request?.subtype === "can_use_tool") {
        transport?.reportState("requires_action");
      }
      void transport?.write(event);
    },

    sendControlResponse(response) {
      const event = { ...response, session_id: currentSessionId };
      transport?.reportState("running");
      void transport?.write(event);
    },

    sendControlCancelRequest(requestId) {
      const event = {
        type: "control_cancel_request" as const,
        request_id: requestId,
        session_id: currentSessionId,
      };
      transport?.reportState("running");
      void transport?.write(event);
    },

    sendResult() {
      transport?.reportState("idle");
      void transport?.write({
        type: "result",
        subtype: "success",
        session_id: currentSessionId,
      });
    },

    async teardown() {
      await teardown();
    },
  };
}

export type { BridgeCoreParams, ReplBridgeHandle, BridgeState };
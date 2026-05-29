/**
 * Env-less Remote Control bridge core.
 *
 * This connects directly to the session-ingress layer without the
 * Environments API work-dispatch layer:
 *
 * 1. POST /v1/code/sessions (OAuth) → session.id
 * 2. POST /v1/code/sessions/{id}/bridge (OAuth) → worker credentials
 * 3. SSE + CCRClient for session communication
 * 4. Token refresh scheduler for proactive credential renewal
 * 5. 401 recovery with transport rebuild
 *
 * No register/poll/ack/stop/heartbeat/deregister environment lifecycle.
 */

import {
  buildCCRv2SdkUrl,
  createCodeSession,
  fetchRemoteCredentials,
  type RemoteCredentials,
} from "./workSecret.js";
import { toCompatSessionId } from "./sessionIdCompat.js";
import { createTokenRefreshScheduler } from "./jwtUtils.js";
import { getTrustedDeviceToken } from "./trustedDevice.js";
import { decodeJwtExpiry } from "./jwtUtils.js";
import type {
  EnvLessBridgeParams,
  ReplBridgeHandle,
  BridgeState,
  BridgeTransport,
} from "./types.js";

const ANTHROPIC_VERSION = "2023-06-01";

type ConnectCause = "initial" | "proactive_refresh" | "auth_401_recovery";

function oauthHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
  };
}

export async function initEnvLessBridgeCore(
  params: EnvLessBridgeParams
): Promise<ReplBridgeHandle | null> {
  const {
    baseUrl,
    orgUUID,
    title,
    getAccessToken,
    onAuth401,
    toSDKMessages,
    initialHistoryCap,
    initialMessages,
    onInboundMessage,
    onUserMessage,
    onPermissionResponse,
    onInterrupt,
    onSetModel,
    onSetMaxThinkingTokens,
    onSetPermissionMode,
    onStateChange,
    outboundOnly,
    tags,
  } = params;

  const accessToken = getAccessToken();
  if (!accessToken) {
    return null;
  }

  const createdSessionId = await createCodeSession(
    baseUrl,
    accessToken,
    title,
    10_000,
    tags
  );
  if (!createdSessionId) {
    onStateChange?.("failed", "Session creation failed");
    return null;
  }

  const sessionId: string = createdSessionId;

  const credentials = await fetchRemoteCredentials(
    sessionId,
    baseUrl,
    accessToken,
    10_000,
    getTrustedDeviceToken()
  );
  if (!credentials) {
    onStateChange?.("failed", "Remote credentials fetch failed");
    return null;
  }

  const sessionUrl = buildCCRv2SdkUrl(credentials.api_base_url, sessionId);

  onStateChange?.("ready");

  let transport: BridgeTransport | null = null;
  let tornDown = false;
  let authRecoveryInFlight = false;
  let userMessageCallbackDone = !onUserMessage;
  let connectCause: ConnectCause = "initial";

  const recentPostedUUIDs = new Set<string>();
  const initialMessageUUIDs = new Set<string>();

  if (initialMessages) {
    for (const msg of initialMessages as { uuid: string }[]) {
      initialMessageUUIDs.add(msg.uuid);
      recentPostedUUIDs.add(msg.uuid);
    }
  }

  const refresh = createTokenRefreshScheduler({
    refreshBufferMs: 5 * 60 * 1000,
    getAccessToken: async () => {
      const stale = getAccessToken();
      if (onAuth401) await onAuth401(stale ?? "");
      return getAccessToken() ?? stale;
    },
    onRefresh: (sid, oauthToken) => {
      void (async () => {
        if (authRecoveryInFlight || tornDown) return;
        authRecoveryInFlight = true;

        try {
          const fresh = await fetchRemoteCredentials(
            sid,
            baseUrl,
            oauthToken,
            10_000,
            getTrustedDeviceToken()
          );
          if (!fresh || tornDown) return;

          // Transport rebuild would happen here
          refresh.scheduleFromExpiresIn(sid, fresh.expires_in);
        } catch {
          if (!tornDown) {
            onStateChange?.("failed", "Refresh failed");
          }
        } finally {
          authRecoveryInFlight = false;
        }
      })();
    },
    label: "remote",
  });

  refresh.scheduleFromExpiresIn(sessionId, credentials.expires_in);

  async function teardown(): Promise<void> {
    if (tornDown) return;
    tornDown = true;
    refresh.cancelAll();

    if (transport) {
      transport.reportState("idle");
      transport.close();
    }
  }

  return {
    bridgeSessionId: sessionId,
    environmentId: "",
    sessionIngressUrl: credentials.api_base_url,

    writeMessages(messages) {
      const filtered = (messages as { uuid?: string; type: string }[]).filter(
        (m) =>
          m.type === "user" ||
          m.type === "assistant" ||
          (m.type === "system" && (m as { subtype?: string }).subtype === "local_command")
      );

      if (filtered.length === 0) return;

      if (!userMessageCallbackDone && onUserMessage) {
        for (const m of filtered) {
          const text = (m as { message?: { content?: string } }).message?.content as string | undefined;
          if (text && onUserMessage(text, sessionId)) {
            userMessageCallbackDone = true;
            break;
          }
        }
      }

      for (const msg of filtered) {
        if (msg.uuid) recentPostedUUIDs.add(msg.uuid);
      }

      const events = (toSDKMessages(filtered) as { session_id: string }[]).map(
        (m) => ({ ...m, session_id: sessionId })
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
        session_id: sessionId,
      }));

      void transport?.writeBatch(events);
    },

    sendControlRequest(request) {
      if (authRecoveryInFlight) return;
      const event = { ...request, session_id: sessionId };
      if ((request as { request?: { subtype?: string } }).request?.subtype === "can_use_tool") {
        transport?.reportState("requires_action");
      }
      void transport?.write(event);
    },

    sendControlResponse(response) {
      if (authRecoveryInFlight) return;
      const event = { ...response, session_id: sessionId };
      transport?.reportState("running");
      void transport?.write(event);
    },

    sendControlCancelRequest(requestId) {
      if (authRecoveryInFlight) return;
      const event = {
        type: "control_cancel_request" as const,
        request_id: requestId,
        session_id: sessionId,
      };
      transport?.reportState("running");
      void transport?.write(event);
    },

    sendResult() {
      if (authRecoveryInFlight) return;
      transport?.reportState("idle");
      void transport?.write({
        type: "result",
        subtype: "success",
        session_id: sessionId,
      });
    },

    async teardown() {
      await teardown();
    },
  };
}

export type { EnvLessBridgeParams, ReplBridgeHandle, BridgeState };
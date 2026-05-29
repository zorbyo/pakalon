/**
 * Telegram bridge command helpers for `/connect` and `/connect-end`.
 *
 * Features:
 * - First-time token onboarding (store token)
 * - Best-effort backend persistence (when endpoint is available)
 * - Runtime long-poll bridge for live Telegram messages while CLI runs
 * - Optional webhook setup via PAKALON_TELEGRAM_WEBHOOK_URL
 */
import fs from "fs";
import os from "os";
import path from "path";
import { getApiClient } from "@/api/client.js";
import { debugLog } from "@/utils/logger.js";
import type { CommandDefinition } from "./types.js";

export interface TelegramInboundMessage {
  chatId: number;
  text: string;
  fromUsername?: string;
}

export interface ConnectTelegramOptions {
  token?: string;
  webhookUrl?: string;
  onMessage?: (message: TelegramInboundMessage) => Promise<void> | void;
}

export interface ConnectTelegramResult {
  status: "connected" | "needs-token";
  usedStoredToken: boolean;
  botUsername?: string;
  webhookEnabled: boolean;
  message: string;
}

export interface DisconnectTelegramResult {
  status: "disconnected";
  webhookCleared: boolean;
  message: string;
}

interface TelegramLocalConfig {
  token: string;
  botUsername?: string;
  webhookUrl?: string;
  connectedAt: string;
  lastUpdateId?: number;
}

interface TelegramBridgeState {
  token: string;
  abortController: AbortController;
  pollPromise: Promise<void>;
  onMessage?: (message: TelegramInboundMessage) => Promise<void> | void;
  lastUpdateId: number;
}

let bridgeState: TelegramBridgeState | null = null;

function getConfigPath(): string {
  return path.join(os.homedir(), ".config", "pakalon", "telegram.json");
}

function readLocalConfig(): TelegramLocalConfig | null {
  try {
    const raw = fs.readFileSync(getConfigPath(), "utf-8");
    const parsed = JSON.parse(raw) as TelegramLocalConfig;
    if (!parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLocalConfig(config: TelegramLocalConfig): void {
  const filePath = getConfigPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8");
}

function clearLocalConfig(): void {
  const filePath = getConfigPath();
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function maskToken(token: string): string {
  if (token.length <= 8) return "********";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

async function callTelegramApi<T>(
  token: string,
  method: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  const endpoint = `https://api.telegram.org/bot${token}/${method}`;
  const response = await fetch(endpoint, {
    method: payload ? "POST" : "GET",
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });

  const raw = await response.text();
  let parsed: { ok?: boolean; result?: T; description?: string };
  try {
    parsed = JSON.parse(raw) as { ok?: boolean; result?: T; description?: string };
  } catch {
    throw new Error(`Telegram API returned invalid JSON (${response.status}).`);
  }

  if (!response.ok || parsed.ok === false) {
    throw new Error(parsed.description ?? `Telegram API error (${response.status}).`);
  }

  return parsed.result as T;
}

async function fetchTokenFromBackend(): Promise<string | null> {
  try {
    const response = await getApiClient().get<{ token?: string }>("/users/me/telegram-token");
    return response.data?.token ?? null;
  } catch {
    return null;
  }
}

async function storeTokenInBackend(token: string, botUsername?: string, webhookUrl?: string): Promise<void> {
  try {
    await getApiClient().put("/users/me/telegram-token", {
      token,
      bot_username: botUsername,
      webhook_url: webhookUrl,
    });
  } catch (err) {
    debugLog("[connect] backend token store skipped", { err: String(err) });
  }
}

async function clearTokenInBackend(): Promise<void> {
  try {
    await getApiClient().delete("/users/me/telegram-token");
  } catch (err) {
    debugLog("[connect] backend token clear skipped", { err: String(err) });
  }
}

function stopPollingBridge(): void {
  if (!bridgeState) return;
  bridgeState.abortController.abort();
  bridgeState = null;
}

function startPollingBridge(
  token: string,
  onMessage?: (message: TelegramInboundMessage) => Promise<void> | void,
  initialOffset = 0,
): void {
  stopPollingBridge();

  const abortController = new AbortController();

  const state: TelegramBridgeState = {
    token,
    abortController,
    onMessage,
    lastUpdateId: initialOffset,
    pollPromise: Promise.resolve(),
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const loop = async () => {
    while (!abortController.signal.aborted) {
      try {
        const updates = await callTelegramApi<Array<Record<string, any>>>(
          token,
          "getUpdates",
          {
            timeout: 20,
            offset: state.lastUpdateId + 1,
            allowed_updates: ["message"],
          },
        );

        for (const update of updates) {
          const updateId = Number(update.update_id ?? 0);
          if (!Number.isNaN(updateId) && updateId > state.lastUpdateId) {
            state.lastUpdateId = updateId;
          }

          const message = update.message;
          const chatId = Number(message?.chat?.id);
          const text = String(message?.text ?? "").trim();
          if (!chatId || !text) continue;

          const incoming: TelegramInboundMessage = {
            chatId,
            text,
            fromUsername: message?.from?.username,
          };

          try {
            await state.onMessage?.(incoming);
          } catch (err) {
            debugLog("[connect] onMessage handler failed", { err: String(err) });
          }
        }
      } catch (err) {
        if (abortController.signal.aborted) break;
        debugLog("[connect] polling failed; retrying", { err: String(err) });
        await sleep(1500);
      }
    }
  };

  state.pollPromise = loop();
  bridgeState = state;
}

export async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  const token = bridgeState?.token ?? readLocalConfig()?.token ?? await fetchTokenFromBackend();
  if (!token) {
    throw new Error("Telegram is not connected.");
  }

  const safeText = text.length > 3900 ? `${text.slice(0, 3900)}…` : text;
  await callTelegramApi(token, "sendMessage", {
    chat_id: chatId,
    text: safeText,
  });
}

export function isTelegramConnected(): boolean {
  return bridgeState !== null;
}

export async function cmdConnectTelegram(options: ConnectTelegramOptions = {}): Promise<ConnectTelegramResult> {
  const explicitToken = options.token?.trim();
  const local = readLocalConfig();
  const backendToken = explicitToken ? null : await fetchTokenFromBackend();

  const token = explicitToken || backendToken || local?.token;
  if (!token) {
    return {
      status: "needs-token",
      usedStoredToken: false,
      webhookEnabled: false,
      message: "No Telegram bot token found.",
    };
  }

  const me = await callTelegramApi<{ username?: string }>(token, "getMe");
  const botUsername = me.username;

  const webhookUrl = options.webhookUrl ?? process.env.PAKALON_TELEGRAM_WEBHOOK_URL ?? local?.webhookUrl;
  let webhookEnabled = false;

  if (webhookUrl) {
    await callTelegramApi(token, "setWebhook", {
      url: webhookUrl,
      drop_pending_updates: false,
    });
    webhookEnabled = true;
  }

  writeLocalConfig({
    token,
    botUsername,
    webhookUrl,
    connectedAt: new Date().toISOString(),
    lastUpdateId: local?.lastUpdateId ?? 0,
  });

  await storeTokenInBackend(token, botUsername, webhookUrl);

  startPollingBridge(token, options.onMessage, local?.lastUpdateId ?? 0);

  debugLog("[connect] telegram connected", {
    usedStoredToken: !explicitToken,
    token: maskToken(token),
    botUsername,
    webhookEnabled,
  });

  return {
    status: "connected",
    usedStoredToken: !explicitToken,
    botUsername,
    webhookEnabled,
    message: "Telegram connected.",
  };
}

export async function cmdDisconnectTelegram(): Promise<DisconnectTelegramResult> {
  const local = readLocalConfig();
  const token = bridgeState?.token ?? local?.token ?? await fetchTokenFromBackend();

  stopPollingBridge();

  let webhookCleared = false;
  if (token) {
    try {
      await callTelegramApi(token, "deleteWebhook", { drop_pending_updates: true });
      webhookCleared = true;
    } catch (err) {
      debugLog("[connect] deleteWebhook failed", { err: String(err) });
    }
  }

  clearLocalConfig();
  await clearTokenInBackend();

  return {
    status: "disconnected",
    webhookCleared,
    message: webhookCleared
      ? "Telegram disconnected and webhook removed."
      : "Telegram disconnected.",
  };
}

export const connectCommandDefinition: CommandDefinition = {
  name: "connect",
  description: "Connect the Telegram runtime bridge",
  usage: "/connect [bot-token]",
  category: "advanced",
  async execute(_context, args) {
    const token = args.join(" ").trim() || undefined;
    const result = await cmdConnectTelegram({ token });

    if (result.status === "needs-token") {
      return {
        success: false,
        message: "No Telegram bot token found. Run /connect <bot-token> or paste a token when prompted in the chat UI.",
        data: { status: result.status },
      };
    }

    return {
      success: true,
      message: [
        `Telegram connected${result.botUsername ? ` as @${result.botUsername}` : ""}.`,
        result.webhookEnabled ? "Webhook mode is enabled." : "Long-poll bridge is running while the CLI is open.",
      ].join("\n"),
      data: { status: result.status, botUsername: result.botUsername, webhookEnabled: result.webhookEnabled },
    };
  },
};

export const connectEndCommandDefinition: CommandDefinition = {
  name: "connect-end",
  description: "Disconnect the Telegram runtime bridge",
  usage: "/connect-end",
  category: "advanced",
  async execute() {
    const result = await cmdDisconnectTelegram();
    return {
      success: true,
      message: result.message,
      data: { status: result.status, webhookCleared: result.webhookCleared },
    };
  },
};

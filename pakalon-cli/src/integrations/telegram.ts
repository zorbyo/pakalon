/**
 * Telegram Integration
 *
 * Provides Telegram bot integration for remote control of Pakalon.
 * Allows users to send prompts and receive responses via Telegram.
 *
 * Features:
 * - Webhook-based communication
 * - Command parsing (/connect, /connect-end)
 * - Message forwarding to Pakalon
 * - Response delivery
 * - Session management
 */

import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TelegramConfig {
  /** Bot token from BotFather */
  botToken: string;
  /** Webhook URL (for production) */
  webhookUrl?: string;
  /** Allowed user IDs (empty = allow all) */
  allowedUserIds?: number[];
  /** Session timeout in ms */
  sessionTimeout?: number;
}

export interface TelegramMessage {
  /** Message ID */
  messageId: number;
  /** Chat ID */
  chatId: number;
  /** User ID */
  userId: number;
  /** Username */
  username?: string;
  /** First name */
  firstName?: string;
  /** Message text */
  text: string;
  /** Timestamp */
  timestamp: number;
}

export interface TelegramSession {
  /** Session ID */
  sessionId: string;
  /** Chat ID */
  chatId: number;
  /** User ID */
  userId: number;
  /** Connected at */
  connectedAt: number;
  /** Last activity */
  lastActivity: number;
  /** Active */
  active: boolean;
}

// ---------------------------------------------------------------------------
// Telegram Bot Client
// ---------------------------------------------------------------------------

class TelegramBotClient {
  private config: TelegramConfig;
  private sessions: Map<number, TelegramSession> = new Map();
  private messageHandlers: Set<(message: TelegramMessage) => void> = new Set();
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private lastUpdateId = 0;

  constructor(config: TelegramConfig) {
    this.config = {
      sessionTimeout: 30 * 60 * 1000, // 30 minutes
      ...config,
    };
  }

  /**
   * Send message to chat
   */
  async sendMessage(chatId: number, text: string): Promise<boolean> {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${this.config.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: "Markdown",
          }),
        }
      );

      if (!response.ok) {
        logger.error(`[Telegram] Failed to send message: ${response.status}`);
        return false;
      }

      logger.debug(`[Telegram] Message sent to chat ${chatId}`);
      return true;
    } catch (error) {
      logger.error(`[Telegram] Send error: ${error}`);
      return false;
    }
  }

  /**
   * Get updates from Telegram
   */
  async getUpdates(): Promise<TelegramMessage[]> {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${this.config.botToken}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=10`
      );

      if (!response.ok) return [];

      const data = await response.json();
      const messages: TelegramMessage[] = [];

      for (const update of data.result || []) {
        if (update.message) {
          this.lastUpdateId = update.update_id;

          const msg = update.message;
          const message: TelegramMessage = {
            messageId: msg.message_id,
            chatId: msg.chat.id,
            userId: msg.from?.id || 0,
            username: msg.from?.username,
            firstName: msg.from?.first_name,
            text: msg.text || "",
            timestamp: msg.date * 1000,
          };

          // Check if user is allowed
          if (
            this.config.allowedUserIds &&
            this.config.allowedUserIds.length > 0 &&
            !this.config.allowedUserIds.includes(message.userId)
          ) {
            logger.warn(`[Telegram] Unauthorized user: ${message.userId}`);
            continue;
          }

          messages.push(message);
        }
      }

      return messages;
    } catch (error) {
      logger.error(`[Telegram] Get updates error: ${error}`);
      return [];
    }
  }

  /**
   * Start polling for messages
   */
  startPolling(intervalMs: number = 1000): void {
    if (this.pollingInterval) return;

    logger.info("[Telegram] Started polling");

    this.pollingInterval = setInterval(async () => {
      const messages = await this.getUpdates();
      for (const message of messages) {
        this.handleMessage(message);
      }
    }, intervalMs);
  }

  /**
   * Stop polling
   */
  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      logger.info("[Telegram] Stopped polling");
    }
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(message: TelegramMessage): Promise<void> {
    const text = message.text.trim();

    // Handle commands
    if (text === "/connect") {
      await this.handleConnect(message);
      return;
    }

    if (text === "/connect-end") {
      await this.handleDisconnect(message);
      return;
    }

    if (text === "/status") {
      await this.handleStatus(message);
      return;
    }

    // Forward message to handlers
    for (const handler of this.messageHandlers) {
      try {
        handler(message);
      } catch (error) {
        logger.error(`[Telegram] Handler error: ${error}`);
      }
    }
  }

  /**
   * Handle /connect command
   */
  private async handleConnect(message: TelegramMessage): Promise<void> {
    const session: TelegramSession = {
      sessionId: `tg-${message.chatId}-${Date.now()}`,
      chatId: message.chatId,
      userId: message.userId,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      active: true,
    };

    this.sessions.set(message.chatId, session);

    await this.sendMessage(
      message.chatId,
      `✅ *Connected to Pakalon*\n\nSession ID: \`${session.sessionId}\`\n\nYou can now send prompts to Pakalon.\n\nCommands:\n/connect-end - Disconnect\n/status - Check connection status`
    );

    logger.info(`[Telegram] User ${message.userId} connected (session: ${session.sessionId})`);
  }

  /**
   * Handle /connect-end command
   */
  private async handleDisconnect(message: TelegramMessage): Promise<void> {
    const session = this.sessions.get(message.chatId);
    if (session) {
      session.active = false;
      this.sessions.delete(message.chatId);

      await this.sendMessage(message.chatId, "✅ *Disconnected from Pakalon*");
      logger.info(`[Telegram] User ${message.userId} disconnected`);
    } else {
      await this.sendMessage(message.chatId, "❌ *Not connected*");
    }
  }

  /**
   * Handle /status command
   */
  private async handleStatus(message: TelegramMessage): Promise<void> {
    const session = this.sessions.get(message.chatId);
    if (session && session.active) {
      const duration = Math.floor((Date.now() - session.connectedAt) / 1000);
      await this.sendMessage(
        message.chatId,
        `📊 *Connection Status*\n\nSession: \`${session.sessionId}\`\nDuration: ${duration}s\nStatus: Active`
      );
    } else {
      await this.sendMessage(message.chatId, "❌ *Not connected*\n\nUse /connect to start.");
    }
  }

  /**
   * Register message handler
   */
  onMessage(handler: (message: TelegramMessage) => void): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  /**
   * Get active session for chat
   */
  getSession(chatId: number): TelegramSession | undefined {
    return this.sessions.get(chatId);
  }

  /**
   * Check if chat is connected
   */
  isConnected(chatId: number): boolean {
    const session = this.sessions.get(chatId);
    return session?.active === true;
  }

  /**
   * Cleanup expired sessions
   */
  cleanupSessions(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [chatId, session] of this.sessions) {
      if (now - session.lastActivity > (this.config.sessionTimeout || 1800000)) {
        session.active = false;
        this.sessions.delete(chatId);
        cleaned++;
      }
    }

    return cleaned;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let client: TelegramBotClient | null = null;

/**
 * Initialize Telegram bot
 */
export function initTelegram(config: TelegramConfig): TelegramBotClient {
  client = new TelegramBotClient(config);
  return client;
}

/**
 * Get Telegram bot client
 */
export function getTelegramClient(): TelegramBotClient | null {
  return client;
}

/**
 * Send message via Telegram
 */
export async function sendTelegramMessage(
  chatId: number,
  text: string
): Promise<boolean> {
  if (!client) {
    logger.error("[Telegram] Client not initialized");
    return false;
  }
  return client.sendMessage(chatId, text);
}

/**
 * Check if Telegram is connected for a chat
 */
export function isTelegramConnected(chatId: number): boolean {
  return client?.isConnected(chatId) ?? false;
}

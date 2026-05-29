/**
 * Session Handler
 * Handles direct connect session events and messaging
 */
import type {
  DirectConnectSession,
  SessionOptions,
  SessionEvent,
  ServerMessage,
  ClientInfo,
} from './types.js';
import { getDirectConnectManager } from './directConnectManager.js';
import logger from '@/utils/logger.js';

export type SessionEventHandler = (event: SessionEvent) => void | Promise<void>;
export type MessageHandler = (message: ServerMessage) => void | Promise<void>;

class SessionHandler {
  private session: DirectConnectSession | null = null;
  private eventHandlers: Set<SessionEventHandler> = new Set();
  private messageHandlers: Set<MessageHandler> = new Set();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  async createSession(options: SessionOptions = {}): Promise<DirectConnectSession> {
    const manager = getDirectConnectManager();
    this.session = await manager.createSession(options);

    this.session.clientInfo = options as unknown as ClientInfo;

    this.startHeartbeat(options.heartbeatInterval || 30000);
    this.emitEvent({
      type: 'connecting',
      sessionId: this.session.id,
      timestamp: Date.now(),
    });

    return this.session;
  }

  async close(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.session) {
      const manager = getDirectConnectManager();
      await manager.destroySession(this.session.id);
      this.emitEvent({
        type: 'disconnected',
        sessionId: this.session.id,
        timestamp: Date.now(),
      });
      this.session = null;
    }
  }

  getSession(): DirectConnectSession | null {
    return this.session;
  }

  getSessionId(): string | null {
    return this.session?.id || null;
  }

  isConnected(): boolean {
    return this.session?.status === 'connected';
  }

  onEvent(handler: SessionEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  async send(message: ServerMessage): Promise<void> {
    if (!this.session || this.session.status !== 'connected') {
      throw new Error('Session not connected');
    }

    logger.debug(`[SessionHandler] Sending message type: ${message.type}`);
    this.session.lastActivity = new Date().toISOString();
  }

  private emitEvent(event: SessionEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        logger.error(`[SessionHandler] Event handler error: ${error}`);
      }
    }
  }

  private emitMessage(message: ServerMessage): void {
    for (const handler of this.messageHandlers) {
      try {
        handler(message);
      } catch (error) {
        logger.error(`[SessionHandler] Message handler error: ${error}`);
      }
    }
  }

  private startHeartbeat(interval: number): void {
    this.heartbeatTimer = setInterval(async () => {
      if (this.session && this.session.status === 'connected') {
        try {
          await this.send({
            type: 'heartbeat',
            sessionId: this.session.id,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          logger.error(`[SessionHandler] Heartbeat failed: ${error}`);
        }
      }
    }, interval);
  }
}

export function createSessionHandler(): SessionHandler {
  return new SessionHandler();
}

export { SessionHandler };
export type { SessionEventHandler, MessageHandler };
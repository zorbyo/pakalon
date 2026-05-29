import { EventEmitter } from 'events';
import { WebSocketTransport } from './transports/websocket.js';
import { SSETransport } from './transports/sse.js';
import type { Message, Session } from './types.js';
import logger from '@/utils/logger.js';

export type BridgeStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface BridgeConfig {
  url: string;
  transport?: 'websocket' | 'sse';
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  authToken?: string;
}

export interface BridgeSession {
  id: string;
  remoteId: string;
  ownerId: string;
  createdAt: string;
  lastActivity: string;
  status: 'active' | 'paused' | 'ended';
}

const DEFAULT_BRIDGE_CONFIG: Partial<BridgeConfig> = {
  transport: 'websocket',
  reconnect: true,
  reconnectInterval: 3000,
  maxReconnectAttempts: 5,
};

export class Bridge extends EventEmitter {
  private config: BridgeConfig;
  private status: BridgeStatus = 'disconnected';
  private sessions: Map<string, BridgeSession> = new Map();
  private transport: WebSocketTransport | SSETransport | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private sessionId: string | null = null;

  constructor(config: BridgeConfig) {
    super();
    this.config = { ...DEFAULT_BRIDGE_CONFIG, ...config };
  }

  async connect(): Promise<boolean> {
    if (this.status === 'connected') {
      return true;
    }

    this.setStatus('connecting');

    try {
      if (this.config.transport === 'websocket') {
        this.transport = new WebSocketTransport({
          url: this.config.url,
          authToken: this.config.authToken,
          onMessage: this.handleMessage.bind(this),
          onError: this.handleError.bind(this),
          onClose: this.handleClose.bind(this),
        });
      } else {
        this.transport = new SSETransport({
          url: this.config.url,
          authToken: this.config.authToken,
          onMessage: this.handleMessage.bind(this),
          onError: this.handleError.bind(this),
          onClose: this.handleClose.bind(this),
        });
      }

      await this.transport.connect();

      this.setStatus('connected');
      this.reconnectAttempts = 0;

      this.emit('connected');

      return true;
    } catch (err) {
      logger.error('Bridge connection failed:', err);
      this.setStatus('error');
      this.emit('error', err);

      if (this.config.reconnect) {
        this.scheduleReconnect();
      }

      return false;
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.transport) {
      this.transport.disconnect();
      this.transport = null;
    }

    this.sessions.clear();
    this.setStatus('disconnected');
    this.emit('disconnected');
  }

  async createSession(ownerId: string): Promise<BridgeSession | null> {
    if (!this.transport || this.status !== 'connected') {
      logger.warn('Cannot create session: not connected');
      return null;
    }

    const session: BridgeSession = {
      id: this.generateSessionId(),
      remoteId: '',
      ownerId,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      status: 'active',
    };

    const response = await this.sendRequest('session.create', {
      ownerId,
    });

    if (response.success && response.data?.remoteId) {
      session.remoteId = response.data.remoteId;
      this.sessions.set(session.id, session);
      this.emit('sessionCreated', session);
      return session;
    }

    return null;
  }

  async joinSession(remoteId: string): Promise<BridgeSession | null> {
    if (!this.transport || this.status !== 'connected') {
      logger.warn('Cannot join session: not connected');
      return null;
    }

    const response = await this.sendRequest('session.join', {
      remoteId,
    });

    if (response.success && response.data) {
      const session: BridgeSession = {
        id: this.generateSessionId(),
        remoteId,
        ownerId: response.data.ownerId || '',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        status: 'active',
      };

      this.sessions.set(session.id, session);
      this.sessionId = session.id;

      this.emit('sessionJoined', session);

      return session;
    }

    return null;
  }

  async sendMessage(sessionId: string, message: Message): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn(`Session not found: ${sessionId}`);
      return false;
    }

    const response = await this.sendRequest('session.message', {
      remoteId: session.remoteId,
      message,
    });

    session.lastActivity = new Date().toISOString();

    return response.success;
  }

  async pauseSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    const response = await this.sendRequest('session.pause', {
      remoteId: session.remoteId,
    });

    if (response.success) {
      session.status = 'paused';
      this.emit('sessionPaused', session);
      return true;
    }

    return false;
  }

  async resumeSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'paused') {
      return false;
    }

    const response = await this.sendRequest('session.resume', {
      remoteId: session.remoteId,
    });

    if (response.success) {
      session.status = 'active';
      this.emit('sessionResumed', session);
      return true;
    }

    return false;
  }

  async endSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    const response = await this.sendRequest('session.end', {
      remoteId: session.remoteId,
    });

    if (response.success) {
      session.status = 'ended';
      this.sessions.delete(sessionId);
      this.emit('sessionEnded', session);
      return true;
    }

    return false;
  }

  getStatus(): BridgeStatus {
    return this.status;
  }

  getSessions(): BridgeSession[] {
    return Array.from(this.sessions.values());
  }

  getCurrentSession(): BridgeSession | null {
    if (this.sessionId) {
      return this.sessions.get(this.sessionId) || null;
    }
    return null;
  }

  isConnected(): boolean {
    return this.status === 'connected';
  }

  private setStatus(status: BridgeStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.emit('statusChanged', status);
    }
  }

  private async sendRequest(
    type: string,
    data: Record<string, unknown>
  ): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
    if (!this.transport) {
      return { success: false, error: 'Not connected' };
    }

    try {
      const response = await this.transport.send({
        type,
        data,
        timestamp: Date.now(),
      });

      return response;
    } catch (err) {
      logger.error(`Bridge request failed: ${type}`, err);
      return { success: false, error: String(err) };
    }
  }

  private handleMessage(message: Message): void {
    this.emit('message', message);
  }

  private handleError(err: Error): void {
    logger.error('Bridge error:', err);
    this.emit('error', err);

    if (this.config.reconnect) {
      this.scheduleReconnect();
    }
  }

  private handleClose(): void {
    this.setStatus('disconnected');
    this.emit('disconnected');

    if (this.config.reconnect) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    if (this.reconnectAttempts >= (this.config.maxReconnectAttempts || 5)) {
      logger.warn('Max reconnect attempts reached');
      this.emit('reconnectFailed');
      return;
    }

    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      logger.info(`Reconnect attempt ${this.reconnectAttempts}`);
      await this.connect();
    }, this.config.reconnectInterval);
  }

  private generateSessionId(): string {
    return `bridge-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}

export function createBridge(config: BridgeConfig): Bridge {
  return new Bridge(config);
}
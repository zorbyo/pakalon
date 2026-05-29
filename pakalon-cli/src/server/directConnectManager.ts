/**
 * Direct Connect Manager
 * Manages direct connections to remote servers
 */
import { randomUUID } from 'crypto';
import type { ServerConfig, DirectConnectSession, SessionOptions, ConnectionState } from './types.js';
import logger from '@/utils/logger.js';

class DirectConnectManager {
  private sessions: Map<string, DirectConnectSession> = new Map();
  private config: ServerConfig;

  constructor(config: ServerConfig = {}) {
    this.config = {
      host: config.host || 'localhost',
      port: config.port || 8080,
      ssl: config.ssl || false,
      maxConnections: config.maxConnections || 10,
      timeout: config.timeout || 30000,
    };
  }

  async createSession(options: SessionOptions = {}): Promise<DirectConnectSession> {
    const sessionId = options.sessionId || randomUUID();

    const session: DirectConnectSession = {
      id: sessionId,
      host: this.config.host!,
      port: this.config.port!,
      ssl: this.config.ssl!,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      status: 'connecting',
    };

    this.sessions.set(sessionId, session);
    logger.info(`[DirectConnect] Created session ${sessionId}`);

    try {
      await this.connect(sessionId);
      session.status = 'connected';
      this.sessions.set(sessionId, session);
    } catch (error) {
      session.status = 'error';
      this.sessions.set(sessionId, session);
      logger.error(`[DirectConnect] Failed to connect session ${sessionId}: ${error}`);
    }

    return session;
  }

  private async connect(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    await new Promise(resolve => setTimeout(resolve, 100));

    session.status = 'connected';
    session.lastActivity = new Date().toISOString();
  }

  async disconnect(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'disconnected';
      session.lastActivity = new Date().toISOString();
      this.sessions.set(sessionId, session);
      logger.info(`[DirectConnect] Disconnected session ${sessionId}`);
    }
  }

  async destroySession(sessionId: string): Promise<void> {
    await this.disconnect(sessionId);
    this.sessions.delete(sessionId);
    logger.info(`[DirectConnect] Destroyed session ${sessionId}`);
  }

  getSession(sessionId: string): DirectConnectSession | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): DirectConnectSession[] {
    return Array.from(this.sessions.values());
  }

  getConnectionState(sessionId: string): ConnectionState {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        connected: false,
        reconnectAttempts: 0,
        lastError: 'Session not found',
      };
    }

    return {
      connected: session.status === 'connected',
      sessionId,
      lastError: session.status === 'error' ? 'Connection error' : undefined,
      reconnectAttempts: 0,
    };
  }

  async reconnect(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    logger.info(`[DirectConnect] Reconnecting session ${sessionId}`);

    session.status = 'connecting';
    this.sessions.set(sessionId, session);

    try {
      await this.connect(sessionId);
      session.status = 'connected';
      this.sessions.set(sessionId, session);
      return true;
    } catch (error) {
      session.status = 'error';
      this.sessions.set(sessionId, session);
      return false;
    }
  }

  updateConfig(config: Partial<ServerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): ServerConfig {
    return { ...this.config };
  }
}

let globalManager: DirectConnectManager | null = null;

export function getDirectConnectManager(): DirectConnectManager {
  if (!globalManager) {
    globalManager = new DirectConnectManager();
  }
  return globalManager;
}

export function createDirectConnectManager(config?: ServerConfig): DirectConnectManager {
  return new DirectConnectManager(config);
}

export { DirectConnectManager };
export type { ServerConfig, DirectConnectSession, SessionOptions, ConnectionState };
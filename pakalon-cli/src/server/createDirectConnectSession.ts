/**
 * Create Direct Connect Session
 * Factory function for creating direct connect sessions
 */
import type { ServerConfig, SessionOptions, DirectConnectSession } from './types.js';
import { createDirectConnectManager, type DirectConnectManager } from './directConnectManager.js';
import { createSessionHandler, type SessionHandler } from './sessionHandler.js';
import logger from '@/utils/logger.js';

export interface DirectConnectSessionResult {
  session: DirectConnectSession;
  handler: SessionHandler;
  manager: DirectConnectManager;
}

export interface CreateDirectConnectOptions {
  config?: ServerConfig;
  sessionOptions?: SessionOptions;
  autoConnect?: boolean;
}

export async function createDirectConnectSession(
  options: CreateDirectConnectOptions = {},
): Promise<DirectConnectSessionResult> {
  const { config = {}, sessionOptions = {}, autoConnect = true } = options;

  const manager = createDirectConnectManager(config);
  const handler = createSessionHandler();

  logger.info('[DirectConnect] Creating new session');

  if (autoConnect) {
    const session = await handler.createSession(sessionOptions);
    return { session, handler, manager };
  }

  const session: DirectConnectSession = {
    id: crypto.randomUUID(),
    host: config.host || 'localhost',
    port: config.port || 8080,
    ssl: config.ssl || false,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    status: 'disconnected',
  };

  return { session, handler, manager };
}

export async function createLocalSession(
  sessionOptions: SessionOptions = {},
): Promise<DirectConnectSessionResult> {
  return createDirectConnectSession({
    config: {
      host: 'localhost',
      port: 8080,
      ssl: false,
    },
    sessionOptions,
    autoConnect: true,
  });
}

export async function createSecureSession(
  certPath: string,
  keyPath: string,
  sessionOptions: SessionOptions = {},
): Promise<DirectConnectSessionResult> {
  return createDirectConnectSession({
    config: {
      host: 'localhost',
      port: 8443,
      ssl: true,
      sslCert: certPath,
      sslKey: keyPath,
    },
    sessionOptions,
    autoConnect: true,
  });
}

export { createDirectConnectSession as default };
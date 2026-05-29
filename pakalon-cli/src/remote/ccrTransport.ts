/**
 * Remote Agent Launch (CCR) Transport
 *
 * Enables launching agents on remote infrastructure via the session ingress API.
 * This allows spawning agents that run on cloud compute instead of local machine.
 *
 * Features:
 * - Remote session creation and management
 * - Session ingress token handling
 * - Secure communication with remote agents
 * - Session event polling and handling
 * - Teleport capability (transfer execution between local and remote)
 */

import { randomUUID } from 'crypto';
import logger from '@/utils/logger.js';
import { getSessionIngressAuthToken } from '@/utils/sessionIngressAuth.js';

export interface CCRSessionConfig {
  sessionId?: string;
  remoteUrl?: string;
  maxRetries?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface CCRSession {
  id: string;
  remoteUrl: string;
  createdAt: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'terminated';
  agentId?: string;
}

export interface RemoteAgentConfig {
  prompt: string;
  model?: string;
  tools?: string[];
  maxTurns?: number;
  description?: string;
  subagentType?: string;
}

export interface CCRSessionEvents {
  type: 'assistant' | 'user' | 'result' | 'ping';
  message?: unknown;
  subtype?: string;
  sessionStatus?: string;
  eventId?: string;
}

const DEFAULT_CONFIG = {
  maxRetries: 3,
  timeoutMs: 30000,
  pollIntervalMs: 2000,
};

class CCRTransport {
  private sessions: Map<string, CCRSession> = new Map();
  private config: Required<CCRConfig>;
  private eventListeners: Map<string, Array<(event: CCRSessionEvents) => void>> = new Map();

  constructor(config: CCRConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create a new remote session
   */
  async createSession(options: {
    projectDir?: string;
    description?: string;
  } = {}): Promise<CCRSession> {
    const sessionId = `ccr-${randomUUID()}`;
    const ingressToken = getSessionIngressAuthToken();

    if (!ingressToken) {
      throw new Error('Session ingress token not available. Cannot create remote session.');
    }

    const remoteUrl = process.env.CCR_REMOTE_URL || 'https://api.pakalon.ai/ccr';

    try {
      const response = await fetch(`${remoteUrl}/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ingressToken}`,
        },
        body: JSON.stringify({
          sessionId,
          projectDir: options.projectDir,
          description: options.description,
          clientVersion: '1.0.0',
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`Failed to create remote session: ${response.status}`);
      }

      const session: CCRSession = {
        id: sessionId,
        remoteUrl,
        createdAt: Date.now(),
        status: 'pending',
      };

      this.sessions.set(sessionId, session);
      logger.debug(`[CCR] Created session ${sessionId}`);

      return session;
    } catch (err) {
      logger.error(`[CCR] Failed to create session: ${err}`);
      throw err;
    }
  }

  /**
   * Launch an agent in a remote session
   */
  async launchRemoteAgent(
    sessionId: string,
    agentConfig: RemoteAgentConfig
  ): Promise<{ taskId: string; agentId: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const ingressToken = getSessionIngressAuthToken();
    if (!ingressToken) {
      throw new Error('Session ingress token not available');
    }

    const taskId = `task-${randomUUID()}`;
    const agentId = `agent-${randomUUID()}`;

    try {
      const response = await fetch(`${session.remoteUrl}/sessions/${sessionId}/agents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ingressToken}`,
        },
        body: JSON.stringify({
          taskId,
          agentId,
          ...agentConfig,
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`Failed to launch remote agent: ${response.status}`);
      }

      session.agentId = agentId;
      session.status = 'running';

      logger.debug(`[CCR] Launched agent ${agentId} in session ${sessionId}`);

      return { taskId, agentId };
    } catch (err) {
      logger.error(`[CCR] Failed to launch remote agent: ${err}`);
      throw err;
    }
  }

  /**
   * Poll for session events
   */
  async pollSessionEvents(
    sessionId: string,
    cursor?: string
  ): Promise<{
    newEvents: CCRSessionEvents[];
    lastEventId: string | null;
    sessionStatus: string;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const ingressToken = getSessionIngressAuthToken();
    if (!ingressToken) {
      throw new Error('Session ingress token not available');
    }

    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);

    const url = `${session.remoteUrl}/sessions/${sessionId}/events?${params}`;

    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${ingressToken}`,
        },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`Failed to poll session events: ${response.status}`);
      }

      const data = await response.json() as {
        events: CCRSessionEvents[];
        cursor: string | null;
        sessionStatus: string;
      };

      // Notify listeners
      const listeners = this.eventListeners.get(sessionId) || [];
      for (const event of data.events) {
        for (const listener of listeners) {
          try {
            listener(event);
          } catch {
            // Ignore listener errors
          }
        }
      }

      return {
        newEvents: data.events,
        lastEventId: data.cursor,
        sessionStatus: data.sessionStatus,
      };
    } catch (err) {
      logger.error(`[CCR] Failed to poll session events: ${err}`);
      throw err;
    }
  }

  /**
   * Send a message to a running remote agent
   */
  async sendMessage(
    sessionId: string,
    agentId: string,
    message: string
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const ingressToken = getSessionIngressAuthToken();
    if (!ingressToken) {
      throw new Error('Session ingress token not available');
    }

    const response = await fetch(
      `${session.remoteUrl}/sessions/${sessionId}/agents/${agentId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ingressToken}`,
        },
        body: JSON.stringify({ message }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to send message: ${response.status}`);
    }
  }

  /**
   * Stop a remote agent
   */
  async stopAgent(sessionId: string, agentId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const ingressToken = getSessionIngressAuthToken();
    if (!ingressToken) {
      throw new Error('Session ingress token not available');
    }

    const response = await fetch(
      `${session.remoteUrl}/sessions/${sessionId}/agents/${agentId}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${ingressToken}`,
        },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to stop agent: ${response.status}`);
    }

    logger.debug(`[CCR] Stopped agent ${agentId} in session ${sessionId}`);
  }

  /**
   * Terminate a remote session
   */
  async terminateSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const ingressToken = getSessionIngressAuthToken();
    if (!ingressToken) {
      throw new Error('Session ingress token not available');
    }

    const response = await fetch(`${session.remoteUrl}/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${ingressToken}`,
      },
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Failed to terminate session: ${response.status}`);
    }

    session.status = 'terminated';
    this.sessions.delete(sessionId);
    logger.debug(`[CCR] Terminated session ${sessionId}`);
  }

  /**
   * Get session status
   */
  getSession(sessionId: string): CCRSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions
   */
  getAllSessions(): CCRSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Subscribe to session events
   */
  subscribe(
    sessionId: string,
    listener: (event: CCRSessionEvents) => void
  ): () => void {
    const listeners = this.eventListeners.get(sessionId) || [];
    listeners.push(listener);
    this.eventListeners.set(sessionId, listeners);

    return () => {
      const idx = listeners.indexOf(listener);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }

  /**
   * Check if CCR is available (has ingress token)
   */
  isAvailable(): boolean {
    return getSessionIngressAuthToken() !== null;
  }
}

interface CCRConfig {
  maxRetries?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

// Singleton instance
let ccrTransport: CCRTransport | null = null;

export function getCCRTransport(config?: CCRConfig): CCRTransport {
  if (!ccrTransport) {
    ccrTransport = new CCRTransport(config);
  }
  return ccrTransport;
}

export function isCCRAvailable(): boolean {
  return getCCRTransport().isAvailable();
}

export async function createRemoteSession(
  options?: { projectDir?: string; description?: string }
): Promise<CCRSession> {
  return getCCRTransport().createSession(options);
}

export async function launchRemoteAgent(
  sessionId: string,
  agentConfig: RemoteAgentConfig
): Promise<{ taskId: string; agentId: string }> {
  return getCCRTransport().launchRemoteAgent(sessionId, agentConfig);
}

export async function stopRemoteAgent(sessionId: string, agentId: string): Promise<void> {
  return getCCRTransport().stopAgent(sessionId, agentId);
}

export async function terminateRemoteSession(sessionId: string): Promise<void> {
  return getCCRTransport().terminateSession(sessionId);
}

export function getRemoteSession(sessionId: string): CCRSession | undefined {
  return getCCRTransport().getSession(sessionId);
}

export function getAllRemoteSessions(): CCRSession[] {
  return getCCRTransport().getAllSessions();
}

export function subscribeToRemoteSessionEvents(
  sessionId: string,
  listener: (event: CCRSessionEvents) => void
): () => void {
  return getCCRTransport().subscribe(sessionId, listener);
}

export { CCRTransport };
export type {
  CCRSession,
  CCRSessionConfig,
  CCRSessionEvents,
  RemoteAgentConfig,
  CCRConfig,
};
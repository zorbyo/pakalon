/**
 * Multi-Session UI
 *
 * Provides full UI for managing multiple concurrent sessions.
 * Supports:
 * - Session list with status indicators
 * - Loading animations
 * - Session switching
 * - New session creation
 */

import logger from '@/utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionInfo {
  /** Session ID */
  id: string;
  /** Session name */
  name: string;
  /** Session status */
  status: 'idle' | 'running' | 'waiting' | 'completed' | 'error';
  /** Current task */
  currentTask?: string;
  /** Progress (0-100) */
  progress?: number;
  /** Start time */
  startTime: Date;
  /** Last activity time */
  lastActivity: Date;
  /** Model being used */
  model?: string;
  /** Token usage */
  tokenUsage?: { input: number; output: number };
}

export interface MultiSessionConfig {
  /** Max concurrent sessions */
  maxConcurrent: number;
  /** Session timeout (ms) */
  sessionTimeout: number;
  /** Auto-cleanup completed sessions */
  autoCleanup: boolean;
  /** Cleanup delay (ms) */
  cleanupDelay: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const sessions: Map<string, SessionInfo> = new Map();
let activeSessionId: string | null = null;
let config: MultiSessionConfig = {
  maxConcurrent: 5,
  sessionTimeout: 3_600_000, // 1 hour
  autoCleanup: true,
  cleanupDelay: 300_000, // 5 minutes
};

// ---------------------------------------------------------------------------
// Session Management
// ---------------------------------------------------------------------------

/**
 * Create a new session
 */
export function createSession(name: string, model?: string): SessionInfo {
  if (sessions.size >= config.maxConcurrent) {
    throw new Error(`Maximum concurrent sessions reached (${config.maxConcurrent})`);
  }

  const session: SessionInfo = {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    status: 'idle',
    startTime: new Date(),
    lastActivity: new Date(),
    model,
  };

  sessions.set(session.id, session);
  logger.info(`[multi-session] Created session: ${session.name} (${session.id})`);

  return session;
}

/**
 * Get a session by ID
 */
export function getSession(id: string): SessionInfo | undefined {
  return sessions.get(id);
}

/**
 * Get all sessions
 */
export function getAllSessions(): SessionInfo[] {
  return Array.from(sessions.values());
}

/**
 * Get active sessions (not completed or error)
 */
export function getActiveSessions(): SessionInfo[] {
  return getAllSessions().filter((s) => s.status !== 'completed' && s.status !== 'error');
}

/**
 * Update session status
 */
export function updateSessionStatus(
  id: string,
  status: SessionInfo['status'],
  currentTask?: string,
  progress?: number,
): boolean {
  const session = sessions.get(id);
  if (session) {
    session.status = status;
    session.lastActivity = new Date();
    if (currentTask !== undefined) session.currentTask = currentTask;
    if (progress !== undefined) session.progress = progress;
    logger.debug(`[multi-session] Updated session ${id}: ${status}`);
    return true;
  }
  return false;
}

/**
 * Delete a session
 */
export function deleteSession(id: string): boolean {
  const deleted = sessions.delete(id);
  if (deleted) {
    logger.info(`[multi-session] Deleted session: ${id}`);
    if (activeSessionId === id) {
      activeSessionId = null;
    }
  }
  return deleted;
}

/**
 * Clear all sessions
 */
export function clearSessions(): void {
  sessions.clear();
  activeSessionId = null;
  logger.info('[multi-session] Cleared all sessions');
}

// ---------------------------------------------------------------------------
// Active Session
// ---------------------------------------------------------------------------

/**
 * Set active session
 */
export function setActiveSession(id: string): boolean {
  if (sessions.has(id)) {
    activeSessionId = id;
    logger.info(`[multi-session] Set active session: ${id}`);
    return true;
  }
  return false;
}

/**
 * Get active session
 */
export function getActiveSession(): SessionInfo | undefined {
  if (activeSessionId) {
    return sessions.get(activeSessionId);
  }
  return undefined;
}

/**
 * Get active session ID
 */
export function getActiveSessionId(): string | null {
  return activeSessionId;
}

// ---------------------------------------------------------------------------
// UI Rendering
// ---------------------------------------------------------------------------

/**
 * Render session list as text
 */
export function renderSessionList(): string {
  const allSessions = getAllSessions();

  if (allSessions.length === 0) {
    return 'No active sessions. Use /new to create one.';
  }

  const lines: string[] = [
    '# Sessions',
    '',
    '| ID | Name | Status | Progress | Model | Last Activity |',
    '|---|---|---|---|---|---|',
  ];

  for (const session of allSessions) {
    const isActive = session.id === activeSessionId;
    const statusIcon = getStatusIcon(session.status);
    const progressStr = session.progress !== undefined ? `${session.progress}%` : '-';
    const modelStr = session.model ?? '-';
    const lastActivityStr = formatTimeAgo(session.lastActivity);

    lines.push(
      `| ${isActive ? '**' + session.id.slice(0, 8) + '**' : session.id.slice(0, 8)} | ${session.name} | ${statusIcon} ${session.status} | ${progressStr} | ${modelStr} | ${lastActivityStr} |`,
    );
  }

  return lines.join('\n');
}

/**
 * Render session status indicator
 */
export function renderSessionStatus(session: SessionInfo): string {
  const statusIcon = getStatusIcon(session.status);
  const progressStr = session.progress !== undefined ? ` [${session.progress}%]` : '';
  const taskStr = session.currentTask ? ` - ${session.currentTask}` : '';

  return `${statusIcon} ${session.name}${progressStr}${taskStr}`;
}

/**
 * Render loading animation for a session
 */
export function renderLoadingAnimation(session: SessionInfo): string {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const frame = frames[Math.floor(Date.now() / 100) % frames.length];

  return `${frame} ${session.name} - ${session.currentTask ?? 'Processing...'}`;
}

/**
 * Get status icon
 */
function getStatusIcon(status: SessionInfo['status']): string {
  switch (status) {
    case 'idle':
      return '○';
    case 'running':
      return '●';
    case 'waiting':
      return '◐';
    case 'completed':
      return '✓';
    case 'error':
      return '✗';
  }
}

/**
 * Format time ago
 */
function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  return date.toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Auto-Cleanup
// ---------------------------------------------------------------------------

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start auto-cleanup
 */
export function startAutoCleanup(): void {
  if (cleanupTimer) {
    return;
  }

  cleanupTimer = setInterval(() => {
    if (!config.autoCleanup) return;

    const now = new Date();
    for (const session of sessions.values()) {
      if (
        (session.status === 'completed' || session.status === 'error') &&
        now.getTime() - session.lastActivity.getTime() > config.cleanupDelay
      ) {
        sessions.delete(session.id);
        logger.info(`[multi-session] Auto-cleaned session: ${session.id}`);
      }
    }
  }, 60_000); // Check every minute

  logger.info('[multi-session] Started auto-cleanup');
}

/**
 * Stop auto-cleanup
 */
export function stopAutoCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    logger.info('[multi-session] Stopped auto-cleanup');
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Update configuration
 */
export function updateConfig(newConfig: Partial<MultiSessionConfig>): void {
  config = { ...config, ...newConfig };
  logger.info('[multi-session] Configuration updated');
}

/**
 * Get configuration
 */
export function getConfig(): MultiSessionConfig {
  return { ...config };
}

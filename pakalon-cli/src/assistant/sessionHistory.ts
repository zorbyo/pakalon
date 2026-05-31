/**
 * Assistant Session History
 * 
 * Manages session history with pagination for retrieving past events.
 * Provides a unified interface for accessing session history across
 * different storage backends (local, remote, cloud).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionEvent {
  id: string;
  sessionId: string;
  type: 'message' | 'tool_use' | 'tool_result' | 'error' | 'system';
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface HistoryPage {
  /** Chronological order within the page */
  events: SessionEvent[];
  /** Oldest event ID in this page → before_id cursor for next-older page */
  firstId: string | null;
  /** true = older events exist */
  hasMore: boolean;
}

export interface HistoryAuthCtx {
  baseUrl: string;
  headers: Record<string, string>;
}

export interface HistoryPaginationOptions {
  limit?: number;
  beforeId?: string;
  afterId?: string;
  startTime?: number;
  endTime?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const HISTORY_PAGE_SIZE = 100;
export const MAX_HISTORY_PAGE_SIZE = 500;

// ---------------------------------------------------------------------------
// Session History Manager
// ---------------------------------------------------------------------------

export class SessionHistoryManager {
  private authCtx: HistoryAuthCtx | null = null;
  private localCache: Map<string, SessionEvent[]> = new Map();

  /**
   * Create auth context for API requests
   */
  async createAuthCtx(sessionId: string): Promise<HistoryAuthCtx> {
    // In a real implementation, this would fetch from the backend
    // For now, return a placeholder
    return {
      baseUrl: `/api/v1/sessions/${sessionId}/events`,
      headers: {
        'Content-Type': 'application/json',
      },
    };
  }

  /**
   * Set auth context
   */
  setAuthCtx(ctx: HistoryAuthCtx): void {
    this.authCtx = ctx;
  }

  /**
   * Fetch latest events (newest page)
   */
  async fetchLatestEvents(
    sessionId: string,
    limit: number = HISTORY_PAGE_SIZE
  ): Promise<HistoryPage> {
    const effectiveLimit = Math.min(limit, MAX_HISTORY_PAGE_SIZE);
    
    // Check local cache first
    const cached = this.localCache.get(sessionId);
    if (cached && cached.length > 0) {
      const sorted = cached.sort((a, b) => b.timestamp - a.timestamp);
      const events = sorted.slice(0, effectiveLimit);
      return {
        events,
        firstId: events.length > 0 ? events[0]?.id ?? null : null,
        hasMore: sorted.length > effectiveLimit,
      };
    }

    // Return empty page if no cache
    return {
      events: [],
      firstId: null,
      hasMore: false,
    };
  }

  /**
   * Fetch older events (pagination)
   */
  async fetchOlderEvents(
    sessionId: string,
    beforeId: string,
    limit: number = HISTORY_PAGE_SIZE
  ): Promise<HistoryPage> {
    const effectiveLimit = Math.min(limit, MAX_HISTORY_PAGE_SIZE);
    
    // Check local cache first
    const cached = this.localCache.get(sessionId);
    if (cached && cached.length > 0) {
      // Find the index of the beforeId event
      const beforeIndex = cached.findIndex(e => e.id === beforeId);
      if (beforeIndex === -1) {
        return { events: [], firstId: null, hasMore: false };
      }

      const events = cached
        .slice(beforeIndex + 1)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, effectiveLimit);

      return {
        events,
        firstId: events.length > 0 ? events[0]?.id ?? null : null,
        hasMore: cached.length > beforeIndex + 1 + effectiveLimit,
      };
    }

    return { events: [], firstId: null, hasMore: false };
  }

  /**
   * Fetch events by time range
   */
  async fetchEventsByTimeRange(
    sessionId: string,
    startTime: number,
    endTime: number,
    limit: number = HISTORY_PAGE_SIZE
  ): Promise<HistoryPage> {
    const effectiveLimit = Math.min(limit, MAX_HISTORY_PAGE_SIZE);
    
    const cached = this.localCache.get(sessionId);
    if (cached && cached.length > 0) {
      const events = cached
        .filter(e => e.timestamp >= startTime && e.timestamp <= endTime)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, effectiveLimit);

      return {
        events,
        firstId: events.length > 0 ? events[0]?.id ?? null : null,
        hasMore: false,
      };
    }

    return { events: [], firstId: null, hasMore: false };
  }

  /**
   * Add event to local cache
   */
  addEvent(event: SessionEvent): void {
    const cached = this.localCache.get(event.sessionId) || [];
    cached.push(event);
    this.localCache.set(event.sessionId, cached);
  }

  /**
   * Get event count for a session
   */
  getEventCount(sessionId: string): number {
    return this.localCache.get(sessionId)?.length ?? 0;
  }

  /**
   * Clear cache for a session
   */
  clearSessionCache(sessionId: string): void {
    this.localCache.delete(sessionId);
  }

  /**
   * Clear all caches
   */
  clearAllCaches(): void {
    this.localCache.clear();
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const sessionHistoryManager = new SessionHistoryManager();

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Format event for display
 */
export function formatEventForDisplay(event: SessionEvent): string {
  const timestamp = new Date(event.timestamp).toISOString();
  const role = event.role.toUpperCase();
  return `[${timestamp}] ${role}: ${event.content.slice(0, 100)}${event.content.length > 100 ? '...' : ''}`;
}

/**
 * Filter events by type
 */
export function filterEventsByType(
  events: SessionEvent[],
  type: SessionEvent['type']
): SessionEvent[] {
  return events.filter(e => e.type === type);
}

/**
 * Filter events by role
 */
export function filterEventsByRole(
  events: SessionEvent[],
  role: SessionEvent['role']
): SessionEvent[] {
  return events.filter(e => e.role === role);
}

/**
 * Sort events by timestamp
 */
export function sortEventsByTimestamp(
  events: SessionEvent[],
  order: 'asc' | 'desc' = 'desc'
): SessionEvent[] {
  return [...events].sort((a, b) => 
    order === 'asc' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  SessionHistoryManager,
  sessionHistoryManager,
  formatEventForDisplay,
  filterEventsByType,
  filterEventsByRole,
  sortEventsByTimestamp,
  HISTORY_PAGE_SIZE,
  MAX_HISTORY_PAGE_SIZE,
};

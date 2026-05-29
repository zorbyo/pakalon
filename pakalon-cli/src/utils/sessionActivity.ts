/**
 * Session Activity
 * Tracks and manages session activity metrics and timestamps
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import logger from './logger.js'

export interface ActivityEvent {
  type: ActivityType
  timestamp: number
  metadata?: Record<string, unknown>
}

export type ActivityType =
  | 'message_sent'
  | 'message_received'
  | 'tool_used'
  | 'file_edited'
  | 'command_executed'
  | 'session_started'
  | 'session_resumed'
  | 'session_paused'
  | 'session_compacted'
  | 'idle_timeout_warning'
  | 'idle_timeout'

export interface SessionActivityStats {
  lastActivityAt: number
  totalEvents: number
  eventsByType: Record<ActivityType, number>
  idleDurationMs: number
  isActive: boolean
}

const IDLE_THRESHOLD_MS = 5 * 60 * 1000
const IDLE_WARNING_THRESHOLD_MS = 4 * 60 * 1000

class SessionActivityTracker {
  private events: ActivityEvent[] = []
  private sessionId: string | null = null
  private activityFilePath: string | null = null

  initialize(sessionId: string): void {
    this.sessionId = sessionId
    this.events = []
    this.activityFilePath = this.getActivityFilePath(sessionId)
    this.trackEvent('session_started')
  }

  trackEvent(type: ActivityType, metadata?: Record<string, unknown>): void {
    const event: ActivityEvent = {
      type,
      timestamp: Date.now(),
      metadata,
    }

    this.events.push(event)

    if (this.activityFilePath) {
      this.persistEvent(event)
    }

    logger.debug(`[SessionActivity] Tracked event: ${type} for session ${this.sessionId}`)
  }

  getStats(): SessionActivityStats {
    const now = Date.now()
    const lastEvent = this.events[this.events.length - 1]
    const lastActivityAt = lastEvent?.timestamp || now

    const eventsByType = {} as Record<ActivityType, number>
    const allTypes: ActivityType[] = [
      'message_sent',
      'message_received',
      'tool_used',
      'file_edited',
      'command_executed',
      'session_started',
      'session_resumed',
      'session_paused',
      'session_compacted',
      'idle_timeout_warning',
      'idle_timeout',
    ]

    for (const type of allTypes) {
      eventsByType[type] = 0
    }

    for (const event of this.events) {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1
    }

    const idleDurationMs = now - lastActivityAt
    const isActive = idleDurationMs < IDLE_THRESHOLD_MS

    return {
      lastActivityAt,
      totalEvents: this.events.length,
      eventsByType,
      idleDurationMs,
      isActive,
    }
  }

  getIdleDurationMs(): number {
    const lastEvent = this.events[this.events.length - 1]
    if (!lastEvent) return 0
    return Date.now() - lastEvent.timestamp
  }

  isIdle(): boolean {
    return this.getIdleDurationMs() >= IDLE_THRESHOLD_MS
  }

  shouldShowIdleWarning(): boolean {
    const idleDuration = this.getIdleDurationMs()
    return idleDuration >= IDLE_WARNING_THRESHOLD_MS && idleDuration < IDLE_THRESHOLD_MS
  }

  getEventsSince(timestamp: number): ActivityEvent[] {
    return this.events.filter(e => e.timestamp >= timestamp)
  }

  getRecentEvents(count: number = 10): ActivityEvent[] {
    return this.events.slice(-count)
  }

  clear(): void {
    this.events = []
    if (this.activityFilePath && fs.existsSync(this.activityFilePath)) {
      fs.unlinkSync(this.activityFilePath)
    }
  }

  private getActivityFilePath(sessionId: string): string {
    const configDir = path.join(os.homedir(), '.config', 'pakalon', 'activity')
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true })
    }
    return path.join(configDir, `${sessionId}.json`)
  }

  private persistEvent(event: ActivityEvent): void {
    if (!this.activityFilePath) return

    try {
      let events: ActivityEvent[] = []
      if (fs.existsSync(this.activityFilePath)) {
        const raw = fs.readFileSync(this.activityFilePath, 'utf-8')
        events = JSON.parse(raw) as ActivityEvent[]
      }

      events.push(event)

      const recentEvents = events.slice(-1000)
      fs.writeFileSync(this.activityFilePath, JSON.stringify(recentEvents, null, 2), 'utf-8')
    } catch (error) {
      logger.error(`[SessionActivity] Failed to persist event: ${error}`)
    }
  }

  loadPersistedEvents(): ActivityEvent[] {
    if (!this.activityFilePath || !fs.existsSync(this.activityFilePath)) {
      return []
    }

    try {
      const raw = fs.readFileSync(this.activityFilePath, 'utf-8')
      return JSON.parse(raw) as ActivityEvent[]
    } catch {
      return []
    }
  }
}

const globalTracker = new SessionActivityTracker()

export function getSessionActivityTracker(): SessionActivityTracker {
  return globalTracker
}

export function trackSessionActivity(type: ActivityType, metadata?: Record<string, unknown>): void {
  globalTracker.trackEvent(type, metadata)
}

export function getSessionActivityStats(): SessionActivityStats {
  return globalTracker.getStats()
}

export function isSessionIdle(): boolean {
  return globalTracker.isIdle()
}

export function shouldShowIdleWarning(): boolean {
  return globalTracker.shouldShowIdleWarning()
}

export { SessionActivityTracker }
export type { ActivityEvent, ActivityType }

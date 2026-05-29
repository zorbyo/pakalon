/**
 * Session File Access Hooks
 * Tracks file access patterns and provides hooks for file operations during sessions
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import logger from './logger.js'

export interface FileAccessEvent {
  sessionId: string
  filePath: string
  action: FileAccessAction
  timestamp: number
  success: boolean
  error?: string
  durationMs?: number
}

export type FileAccessAction =
  | 'read'
  | 'write'
  | 'edit'
  | 'delete'
  | 'create'
  | 'rename'
  | 'chmod'
  | 'stat'
  | 'list'

export interface FileAccessStats {
  totalAccesses: number
  accessesByAction: Record<FileAccessAction, number>
  mostAccessedFiles: Array<{ path: string; count: number }>
  failedAccesses: number
  averageDurationMs: number
}

export type FileAccessHook = (event: FileAccessEvent) => void | Promise<void>

export type FileAccessFilter = (filePath: string, action: FileAccessAction) => boolean

interface SessionFileAccessState {
  events: FileAccessEvent[]
  hooks: Set<FileAccessHook>
  filters: Set<FileAccessFilter>
  accessCounts: Map<string, number>
}

const sessionStates = new Map<string, SessionFileAccessState>()

function getSessionState(sessionId: string): SessionFileAccessState {
  let state = sessionStates.get(sessionId)
  if (!state) {
    state = {
      events: [],
      hooks: new Set(),
      filters: new Set(),
      accessCounts: new Map(),
    }
    sessionStates.set(sessionId, state)
  }
  return state
}

export function registerFileAccessHook(sessionId: string, hook: FileAccessHook): () => void {
  const state = getSessionState(sessionId)
  state.hooks.add(hook)

  return () => {
    state.hooks.delete(hook)
  }
}

export function addFileAccessFilter(sessionId: string, filter: FileAccessFilter): () => void {
  const state = getSessionState(sessionId)
  state.filters.add(filter)

  return () => {
    state.filters.delete(filter)
  }
}

export function isFileAccessAllowed(sessionId: string, filePath: string, action: FileAccessAction): boolean {
  const state = getSessionState(sessionId)

  for (const filter of state.filters) {
    if (!filter(filePath, action)) {
      return false
    }
  }

  return true
}

export async function recordFileAccess(
  sessionId: string,
  filePath: string,
  action: FileAccessAction,
  success: boolean,
  error?: string,
  durationMs?: number,
): Promise<void> {
  const state = getSessionState(sessionId)

  const event: FileAccessEvent = {
    sessionId,
    filePath: normalizeFilePath(filePath),
    action,
    timestamp: Date.now(),
    success,
    error,
    durationMs,
  }

  state.events.push(event)

  const count = state.accessCounts.get(event.filePath) || 0
  state.accessCounts.set(event.filePath, count + 1)

  for (const hook of state.hooks) {
    try {
      await hook(event)
    } catch (hookError) {
      logger.error(`[FileAccessHooks] Hook error: ${hookError}`)
    }
  }

  persistFileAccessEvent(event)
}

export function wrapFileAccess<T extends (...args: any[]) => Promise<any>>(
  sessionId: string,
  filePath: string,
  action: FileAccessAction,
  fn: T,
): T {
  return (async (...args: any[]) => {
    const startTime = Date.now()

    if (!isFileAccessAllowed(sessionId, filePath, action)) {
      logger.warn(`[FileAccessHooks] File access denied: ${action} ${filePath}`)
      throw new Error(`File access denied: ${action} ${filePath}`)
    }

    try {
      const result = await fn(...args)
      await recordFileAccess(sessionId, filePath, action, true, undefined, Date.now() - startTime)
      return result
    } catch (error) {
      await recordFileAccess(
        sessionId,
        filePath,
        action,
        false,
        error instanceof Error ? error.message : String(error),
        Date.now() - startTime,
      )
      throw error
    }
  }) as T
}

export function getFileAccessStats(sessionId: string): FileAccessStats {
  const state = getSessionState(sessionId)
  const events = state.events

  const accessesByAction = {} as Record<FileAccessAction, number>
  const allActions: FileAccessAction[] = ['read', 'write', 'edit', 'delete', 'create', 'rename', 'chmod', 'stat', 'list']

  for (const action of allActions) {
    accessesByAction[action] = 0
  }

  for (const event of events) {
    accessesByAction[event.action] = (accessesByAction[event.action] || 0) + 1
  }

  const mostAccessedFiles = Array.from(state.accessCounts.entries())
    .map(([p, count]) => ({ path: p, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  const failedAccesses = events.filter(e => !e.success).length
  const eventsWithDuration = events.filter(e => e.durationMs !== undefined)
  const averageDurationMs = eventsWithDuration.length > 0
    ? eventsWithDuration.reduce((sum, e) => sum + (e.durationMs || 0), 0) / eventsWithDuration.length
    : 0

  return {
    totalAccesses: events.length,
    accessesByAction,
    mostAccessedFiles,
    failedAccesses,
    averageDurationMs,
  }
}

export function getRecentFileAccess(sessionId: string, count: number = 20): FileAccessEvent[] {
  const state = getSessionState(sessionId)
  return state.events.slice(-count)
}

export function getFilesAccessedBySession(sessionId: string): string[] {
  const state = getSessionState(sessionId)
  return Array.from(state.accessCounts.keys()).sort()
}

export function clearSessionFileAccessState(sessionId: string): void {
  sessionStates.delete(sessionId)
}

function normalizeFilePath(filePath: string): string {
  try {
    return path.resolve(filePath)
  } catch {
    return filePath
  }
}

function getFileAccessLogPath(): string {
  const logDir = path.join(os.homedir(), '.config', 'pakalon', 'file-access')
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }
  return path.join(logDir, 'access.log')
}

function persistFileAccessEvent(event: FileAccessEvent): void {
  try {
    const logPath = getFileAccessLogPath()
    const line = JSON.stringify(event) + '\n'
    fs.appendFileSync(logPath, line, 'utf-8')
  } catch (error) {
    logger.error(`[FileAccessHooks] Failed to persist event: ${error}`)
  }
}

export function loadFileAccessHistory(sessionId: string, maxEvents: number = 1000): FileAccessEvent[] {
  const logPath = getFileAccessLogPath()
  if (!fs.existsSync(logPath)) return []

  try {
    const content = fs.readFileSync(logPath, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    const events: FileAccessEvent[] = []

    for (const line of lines.slice(-maxEvents)) {
      try {
        const event = JSON.parse(line) as FileAccessEvent
        if (event.sessionId === sessionId) {
          events.push(event)
        }
      } catch {
        continue
      }
    }

    return events
  } catch {
    return []
  }
}

export function isPathSensitive(filePath: string): boolean {
  const sensitivePatterns = [
    /\.env$/,
    /\.env\./,
    /credentials\.json$/,
    /secrets\./,
    /\.ssh\//,
    /\.git\/config$/,
    /id_rsa/,
    /id_ed25519/,
    /\.pem$/,
    /\.key$/,
    /password/,
    /secret/,
    /token/,
  ]

  return sensitivePatterns.some(pattern => pattern.test(filePath))
}

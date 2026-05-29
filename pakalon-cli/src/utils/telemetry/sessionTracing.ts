import { logEvent, logEventAsync, type TelemetryEvent } from './events.js'

export interface SessionTraceEntry {
  id: string
  name: string
  at: string
  durationMs?: number
  data?: Record<string, string | number | boolean | null | undefined>
}

export interface SessionTraceState {
  sessionId: string
  startedAt: string
  entries: SessionTraceEntry[]
}

const MAX_TRACE_ENTRIES = 250
const sessionTraces = new Map<string, SessionTraceState>()

function ensureSession(sessionId: string): SessionTraceState {
  const existing = sessionTraces.get(sessionId)
  if (existing) return existing
  const created: SessionTraceState = {
    sessionId,
    startedAt: new Date().toISOString(),
    entries: [],
  }
  sessionTraces.set(sessionId, created)
  return created
}

export function startSessionTrace(sessionId: string, data: Record<string, unknown> = {}): SessionTraceState {
  const trace = ensureSession(sessionId)
  trace.startedAt = trace.startedAt ?? new Date().toISOString()
  logEvent('session.trace.started', { sessionId, payload: data as Record<string, string | number | boolean | null | undefined> })
  return trace
}

export function addSessionTrace(
  sessionId: string,
  name: string,
  data: Record<string, unknown> = {},
): SessionTraceEntry {
  const trace = ensureSession(sessionId)
  const entry: SessionTraceEntry = {
    id: `${sessionId}:${trace.entries.length + 1}`,
    name,
    at: new Date().toISOString(),
    data: data as Record<string, string | number | boolean | null | undefined>,
  }
  trace.entries.push(entry)
  if (trace.entries.length > MAX_TRACE_ENTRIES) trace.entries.shift()
  logEvent('session.trace.entry', { sessionId, payload: { name, ...data } as Record<string, string | number | boolean | null | undefined> })
  return entry
}

export async function addSessionTraceAsync(
  sessionId: string,
  name: string,
  data: Record<string, unknown> = {},
): Promise<TelemetryEvent> {
  addSessionTrace(sessionId, name, data)
  return await logEventAsync('session.trace.async', { sessionId, payload: { name, ...data } as Record<string, string | number | boolean | null | undefined> })
}

export function endSessionTrace(sessionId: string, data: Record<string, unknown> = {}): SessionTraceState | undefined {
  const trace = sessionTraces.get(sessionId)
  if (!trace) return undefined
  logEvent('session.trace.ended', { sessionId, payload: data as Record<string, string | number | boolean | null | undefined> })
  sessionTraces.delete(sessionId)
  return trace
}

export function getSessionTrace(sessionId: string): SessionTraceState | undefined {
  return sessionTraces.get(sessionId)
}

export function listSessionTraces(): SessionTraceState[] {
  return [...sessionTraces.values()]
}

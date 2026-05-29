export type TelemetryEventLevel = 'debug' | 'info' | 'warn' | 'error'

export type TelemetryEventPayload = Record<string, string | number | boolean | null | undefined>

export interface TelemetryEvent {
  id: string
  name: string
  level: TelemetryEventLevel
  timestamp: string
  sessionId?: string
  parentId?: string
  sequence: number
  payload: TelemetryEventPayload
}

export interface LogEventOptions {
  level?: TelemetryEventLevel
  sessionId?: string
  parentId?: string
  payload?: TelemetryEventPayload
}

const MAX_BUFFERED_EVENTS = 500

let sequence = 0
const bufferedEvents: TelemetryEvent[] = []
const subscribers = new Set<(event: TelemetryEvent) => void>()

function createEventId(name: string): string {
  return `${name}:${Date.now().toString(36)}:${sequence.toString(36)}`
}

function normalizePayload(payload: TelemetryEventPayload = {}): TelemetryEventPayload {
  const normalized: TelemetryEventPayload = {}
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) normalized[key] = value
  }
  return normalized
}

function emitToConsole(event: TelemetryEvent): void {
  const line = `[telemetry] ${event.name}`
  const details = {
    sessionId: event.sessionId,
    parentId: event.parentId,
    sequence: event.sequence,
    ...event.payload,
  }

  switch (event.level) {
    case 'debug':
      console.debug(line, details)
      break
    case 'warn':
      console.warn(line, details)
      break
    case 'error':
      console.error(line, details)
      break
    default:
      console.info(line, details)
      break
  }
}

export function logEvent(name: string, options: LogEventOptions = {}): TelemetryEvent {
  const event: TelemetryEvent = {
    id: createEventId(name),
    name,
    level: options.level ?? 'info',
    timestamp: new Date().toISOString(),
    sessionId: options.sessionId,
    parentId: options.parentId,
    sequence: sequence++,
    payload: normalizePayload(options.payload),
  }

  bufferedEvents.push(event)
  if (bufferedEvents.length > MAX_BUFFERED_EVENTS) {
    bufferedEvents.splice(0, bufferedEvents.length - MAX_BUFFERED_EVENTS)
  }

  emitToConsole(event)

  for (const subscriber of subscribers) {
    try {
      subscriber(event)
    } catch {
      // Telemetry must never break runtime execution.
    }
  }

  return event
}

export async function logEventAsync(
  name: string,
  options: LogEventOptions = {},
): Promise<TelemetryEvent> {
  return await new Promise((resolve) => {
    queueMicrotask(() => resolve(logEvent(name, options)))
  })
}

export function getLoggedEvents(): readonly TelemetryEvent[] {
  return bufferedEvents
}

export function clearLoggedEvents(): void {
  bufferedEvents.length = 0
}

export function subscribeToTelemetryEvents(
  handler: (event: TelemetryEvent) => void,
): () => void {
  subscribers.add(handler)
  return () => subscribers.delete(handler)
}

export function createTelemetryPayload(
  payload: TelemetryEventPayload = {},
): TelemetryEventPayload {
  return normalizePayload(payload)
}

export type { TelemetryEvent as EventRecord }

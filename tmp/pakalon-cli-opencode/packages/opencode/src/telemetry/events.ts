import { Log } from "../util/log"

const log = Log.create({ service: "telemetry:events" })

export interface TelemetryEvent {
  type: string
  category: "prompt" | "model" | "edit" | "chat" | "session" | "pipeline" | "auth" | "billing"
  data: Record<string, unknown>
  timestamp: number
}

export namespace TelemetryEvents {
  const events: TelemetryEvent[] = []

  export function track(
    type: string,
    category: TelemetryEvent["category"],
    data: Record<string, unknown> = {},
  ): TelemetryEvent {
    const event: TelemetryEvent = {
      type,
      category,
      data,
      timestamp: Date.now(),
    }
    events.push(event)
    log.info("tracked event", { type, category })
    return event
  }

  export function promptSent(modelId: string, tokens: number): TelemetryEvent {
    return track("prompt_sent", "prompt", { modelId, tokens })
  }

  export function modelSelected(modelId: string, providerId: string): TelemetryEvent {
    return track("model_selected", "model", { modelId, providerId })
  }

  export function linesChanged(additions: number, deletions: number): TelemetryEvent {
    return track("lines_changed", "edit", { additions, deletions })
  }

  export function suggestionAccepted(modelId: string): TelemetryEvent {
    return track("suggestion_accepted", "edit", { modelId })
  }

  export function suggestionRejected(modelId: string): TelemetryEvent {
    return track("suggestion_rejected", "edit", { modelId })
  }

  export function chatInteraction(sessionId: string): TelemetryEvent {
    return track("chat_interaction", "chat", { sessionId })
  }

  export function sessionCreated(sessionId: string): TelemetryEvent {
    return track("session_created", "session", { sessionId })
  }

  export function pipelineStarted(phase: number, mode: string): TelemetryEvent {
    return track("pipeline_started", "pipeline", { phase, mode })
  }

  export function pipelinePhaseCompleted(phase: number, duration: number): TelemetryEvent {
    return track("pipeline_phase_completed", "pipeline", { phase, duration })
  }

  export function authLogin(method: string): TelemetryEvent {
    return track("auth_login", "auth", { method })
  }

  export function billingUsage(modelId: string, cost: number): TelemetryEvent {
    return track("billing_usage", "billing", { modelId, cost })
  }

  export function list(category?: TelemetryEvent["category"]): TelemetryEvent[] {
    if (category) return events.filter((e) => e.category === category)
    return [...events]
  }

  export function count(category?: TelemetryEvent["category"]): number {
    return list(category).length
  }

  export function clear(): void {
    events.length = 0
  }
}

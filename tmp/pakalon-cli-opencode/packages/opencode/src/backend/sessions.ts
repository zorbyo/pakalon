import { Log } from "../util/log"
import { getClient } from "./client"
import type {
  Session,
  SessionsResponse,
  Message,
  SessionMessagesResponse,
  CreateSessionRequest,
  CreateMessageRequest,
} from "./types"

const log = Log.create({ service: "backend:sessions" })

export namespace SessionsBackend {
  export async function createSession(request: CreateSessionRequest): Promise<Session> {
    const client = getClient()
    log.info("creating session", { title: request.title, model: request.model_id, mode: request.mode })
    const response = await client.post<Session>("/sessions", request)
    log.info("session created", { id: response.id })
    return response
  }

  export async function listSessions(): Promise<SessionsResponse> {
    const client = getClient()
    log.info("listing sessions")
    const response = await client.get<SessionsResponse>("/sessions")
    log.info("sessions listed", { count: response.total })
    return response
  }

  export async function getSession(sessionId: string): Promise<Session> {
    const client = getClient()
    log.info("getting session", { sessionId })
    const response = await client.get<Session>(`/sessions/${sessionId}`)
    log.info("session retrieved", { id: response.id })
    return response
  }

  export async function updateSession(
    sessionId: string,
    updates: Partial<Session>,
  ): Promise<Session> {
    const client = getClient()
    log.info("updating session", { sessionId, updates })
    const response = await client.patch<Session>(`/sessions/${sessionId}`, updates)
    log.info("session updated", { id: response.id })
    return response
  }

  export async function deleteSession(sessionId: string): Promise<void> {
    const client = getClient()
    log.info("deleting session", { sessionId })
    await client.delete(`/sessions/${sessionId}`)
    log.info("session deleted", { sessionId })
  }

  export async function addMessage(
    sessionId: string,
    request: CreateMessageRequest,
  ): Promise<Message> {
    const client = getClient()
    log.info("adding message", { sessionId, role: request.role })
    const response = await client.post<Message>(
      `/sessions/${sessionId}/messages`,
      request,
    )
    log.info("message added", { id: response.id })
    return response
  }

  export async function getMessages(sessionId: string): Promise<SessionMessagesResponse> {
    const client = getClient()
    log.info("getting messages", { sessionId })
    const response = await client.get<SessionMessagesResponse>(
      `/sessions/${sessionId}/messages`,
    )
    log.info("messages retrieved", { count: response.total })
    return response
  }

  export async function recordUsage(
    sessionId: string,
    usage: {
      tokens_used: number
      input_tokens?: number
      output_tokens?: number
      lines_written: number
      model_id: string
      context_window_size?: number
      context_window_used?: number
    },
  ): Promise<void> {
    const client = getClient()
    log.info("recording usage", { sessionId, tokens: usage.tokens_used })
    await client.post(`/sessions/${sessionId}/usage`, {
      model_id: usage.model_id,
      tokens_used: usage.tokens_used,
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      lines_written: usage.lines_written,
      context_window_size: usage.context_window_size ?? 128_000,
      context_window_used: usage.context_window_used ?? Math.max(usage.tokens_used, 0),
    })
    log.info("usage recorded", { sessionId })
  }

  export async function getPrompts(sessionId: string): Promise<{ prompts: string[] }> {
    const client = getClient()
    log.info("getting prompts", { sessionId })
    const response = await client.get<{ prompts: string[] }>(
      `/sessions/${sessionId}/prompts`,
    )
    log.info("prompts retrieved", { count: response.prompts.length })
    return response
  }
}

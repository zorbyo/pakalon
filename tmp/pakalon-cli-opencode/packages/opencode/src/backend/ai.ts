import { Log } from "../util/log"
import { getClient } from "./client"
import type { ChatRequest, ChatResponse, ChatStreamChunk, ChatMessage } from "./types"

const log = Log.create({ service: "backend:ai" })

export namespace AIProxy {
  export async function chat(request: ChatRequest): Promise<ChatResponse> {
    const client = getClient()
    const model = request.model ?? request.model_id
    if (!model) {
      throw new Error("Chat request requires model or model_id")
    }

    const payload: ChatRequest = {
      ...request,
      model,
    }

    log.info("sending chat request", { model, messageCount: request.messages.length })
    const response = await client.post<ChatResponse>("/ai/chat", payload)
    log.info("chat response received", {
      model: response.model,
      tokens:
        (response.prompt_tokens ?? 0) +
        (response.completion_tokens ?? 0) +
        (response.usage?.total_tokens ?? 0),
    })
    return response
  }

  export async function* streamChat(
    request: ChatRequest,
  ): AsyncGenerator<string, void, unknown> {
    const client = getClient()
    const model = request.model ?? request.model_id
    if (!model) {
      throw new Error("Chat request requires model or model_id")
    }

    const payload: ChatRequest = {
      ...request,
      model,
      stream: true,
    }

    log.info("starting streaming chat", { model, messageCount: request.messages.length })

    let fullContent = ""
    const queue: string[] = []
    let done = false
    let streamError: string | undefined
    let buffer = ""
    let notifier: (() => void) | null = null

    const notify = () => {
      notifier?.()
      notifier = null
    }

    const parseSseBlock = (block: string) => {
      const lines = block.split("\n")
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line.startsWith("data: ")) continue
        const data = line.slice(6).trim()
        if (!data || data === "[DONE]") {
          done = true
          notify()
          continue
        }

        try {
          const parsed = JSON.parse(data) as ChatStreamChunk

          if (parsed.type === "error") {
            streamError = parsed.detail || "Streaming request failed"
            done = true
            notify()
            continue
          }

          if (parsed.type === "done") {
            done = true
            log.info("stream completed", {
              totalTokens: (parsed.prompt_tokens ?? 0) + (parsed.completion_tokens ?? 0),
              remainingPct: parsed.remaining_pct,
            })
            notify()
            continue
          }

          const content = parsed.content ?? parsed.choices?.[0]?.delta?.content
          if (content) {
            fullContent += content
            queue.push(content)
            notify()
          }
        } catch {
          // Ignore malformed SSE payload line
        }
      }
    }

    const streamPromise = client
      .stream(
        "/ai/chat/stream",
        payload,
        (chunkText: string) => {
          buffer += chunkText
          const blocks = buffer.split("\n\n")
          buffer = blocks.pop() ?? ""
          for (const block of blocks) {
            parseSseBlock(block)
          }
        },
      )
      .catch((error: unknown) => {
        streamError = error instanceof Error ? error.message : String(error)
        done = true
        notify()
      })
      .finally(() => {
        if (buffer.trim().length > 0) {
          parseSseBlock(buffer)
          buffer = ""
        }
        done = true
        notify()
      })

    while (true) {
      if (queue.length > 0) {
        yield queue.shift()!
        continue
      }

      if (done) {
        if (streamError) {
          throw new Error(streamError)
        }
        break
      }

      await new Promise<void>((resolve) => {
        notifier = resolve
      })
    }

    await streamPromise
  }

  export async function simpleChat(
    modelId: string,
    messages: ChatMessage[],
    temperature?: number,
    maxTokens?: number,
  ): Promise<ChatResponse> {
    const request: ChatRequest = {
      model: modelId,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
    }
    return chat(request)
  }
}

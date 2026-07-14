import { Log } from "../util/log"

const log = Log.create({ service: "integrations:mem0" })
const MEM0_BASE_URL = "https://api.mem0.ai/v1"

type AddResponse = {
  id?: string
  memory_id?: string
}

type SearchResponse = {
  results?: Array<{
    content?: string
    score?: number
  }>
}

type GetResponse = {
  content?: string
}

type GetAllResponse = {
  memories?: Array<{
    id?: string
    memory_id?: string
    content?: string
  }>
  results?: Array<{
    id?: string
    memory_id?: string
    content?: string
  }>
}

export namespace Mem0Integration {
  function getApiKey(): string {
    const apiKey = process.env.MEM0_API_KEY
    if (!apiKey) {
      throw new Error("MEM0_API_KEY is required for Mem0 integration")
    }
    return apiKey
  }

  export async function add(
    userId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    const apiKey = getApiKey()

    try {
      log.info("mem0 add started", { userId })
      const response = await fetch(`${MEM0_BASE_URL}/memories`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          user_id: userId,
          content,
          metadata: metadata ?? {},
        }),
      })

      if (!response.ok) {
        throw new Error(`Mem0 add failed with status ${response.status}`)
      }

      const data = (await response.json()) as AddResponse
      const id = data.id ?? data.memory_id
      if (!id) {
        throw new Error("Mem0 add response did not include a memory id")
      }
      log.info("mem0 add completed", { userId, memoryId: id })
      return id
    } catch (error) {
      log.error("mem0 add failed", { userId, error })
      throw error
    }
  }

  export async function search(userId: string, query: string): Promise<Array<{ content: string; score: number }>> {
    const apiKey = getApiKey()

    try {
      log.info("mem0 search started", { userId })
      const response = await fetch(`${MEM0_BASE_URL}/memories/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          user_id: userId,
          query,
        }),
      })

      if (!response.ok) {
        throw new Error(`Mem0 search failed with status ${response.status}`)
      }

      const data = (await response.json()) as SearchResponse
      const results = (data.results ?? []).map((item) => ({
        content: item.content ?? "",
        score: item.score ?? 0,
      }))

      log.info("mem0 search completed", { userId, count: results.length })
      return results
    } catch (error) {
      log.error("mem0 search failed", { userId, error })
      throw error
    }
  }

  export async function get(userId: string, memoryId: string): Promise<string | null> {
    const apiKey = getApiKey()

    try {
      log.info("mem0 get started", { userId, memoryId })
      const response = await fetch(`${MEM0_BASE_URL}/memories/${encodeURIComponent(memoryId)}?user_id=${encodeURIComponent(userId)}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })

      if (response.status === 404) {
        log.info("mem0 get not found", { userId, memoryId })
        return null
      }

      if (!response.ok) {
        throw new Error(`Mem0 get failed with status ${response.status}`)
      }

      const data = (await response.json()) as GetResponse
      return data.content ?? null
    } catch (error) {
      log.error("mem0 get failed", { userId, memoryId, error })
      throw error
    }
  }

  export async function getAll(userId: string): Promise<Array<{ id: string; content: string }>> {
    const apiKey = getApiKey()

    try {
      log.info("mem0 getAll started", { userId })
      const response = await fetch(`${MEM0_BASE_URL}/memories?user_id=${encodeURIComponent(userId)}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })

      if (!response.ok) {
        throw new Error(`Mem0 getAll failed with status ${response.status}`)
      }

      const data = (await response.json()) as GetAllResponse
      const list = data.memories ?? data.results ?? []
      const memories = list
        .map((item) => ({
          id: item.id ?? item.memory_id ?? "",
          content: item.content ?? "",
        }))
        .filter((item) => item.id.length > 0)

      log.info("mem0 getAll completed", { userId, count: memories.length })
      return memories
    } catch (error) {
      log.error("mem0 getAll failed", { userId, error })
      throw error
    }
  }
}

import { Log } from "../util/log"

const log = Log.create({ service: "integration:mem0" })

export interface MemoryEntry {
  id: string
  content: string
  metadata: Record<string, unknown>
  timestamp: number
  relevance?: number
}

export interface MemorySearchResult {
  entries: MemoryEntry[]
  query: string
  totalResults: number
}

const MEM0_API_URL = process.env.MEM0_API_URL ?? "https://api.mem0.ai"

export namespace Mem0 {
  let localMemory: Map<string, MemoryEntry> = new Map()

  export async function store(
    key: string,
    content: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    log.info("storing memory", { key: key.slice(0, 50) })

    const apiKey = process.env.MEM0_API_KEY
    if (!apiKey) {
      log.warn("MEM0_API_KEY not set, using local memory")
      localMemory.set(key, {
        id: key,
        content,
        metadata,
        timestamp: Date.now(),
      })
      return
    }

    try {
      const response = await fetch(`${MEM0_API_URL}/v1/memories`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          content,
          metadata: { ...metadata, key },
        }),
      })

      if (!response.ok) {
        throw new Error(`Mem0 store failed: ${response.statusText}`)
      }
    } catch (err) {
      log.error("store failed", { error: err })
      // Fallback to local memory
      localMemory.set(key, {
        id: key,
        content,
        metadata,
        timestamp: Date.now(),
      })
    }
  }

  export async function retrieve(key: string): Promise<string | undefined> {
    log.info("retrieving memory", { key: key.slice(0, 50) })

    const apiKey = process.env.MEM0_API_KEY
    if (!apiKey) {
      const entry = localMemory.get(key)
      return entry?.content
    }

    try {
      const response = await fetch(`${MEM0_API_URL}/v1/memories/${encodeURIComponent(key)}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })

      if (!response.ok) {
        throw new Error(`Mem0 retrieve failed: ${response.statusText}`)
      }

      const data = (await response.json()) as { content: string }
      return data.content
    } catch (err) {
      log.error("retrieve failed", { error: err })
      const entry = localMemory.get(key)
      return entry?.content
    }
  }

  export async function search(query: string, limit: number = 5): Promise<MemorySearchResult> {
    log.info("searching memory", { query: query.slice(0, 50), limit })

    const apiKey = process.env.MEM0_API_KEY
    if (!apiKey) {
      // Search local memory
      const entries = Array.from(localMemory.values())
        .filter((entry) =>
          entry.content.toLowerCase().includes(query.toLowerCase()) ||
          JSON.stringify(entry.metadata).toLowerCase().includes(query.toLowerCase()),
        )
        .slice(0, limit)

      return {
        entries,
        query,
        totalResults: entries.length,
      }
    }

    try {
      const response = await fetch(`${MEM0_API_URL}/v1/memories/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ query, limit }),
      })

      if (!response.ok) {
        throw new Error(`Mem0 search failed: ${response.statusText}`)
      }

      const data = (await response.json()) as {
        results: Array<{ id: string; content: string; metadata: Record<string, unknown>; score: number }>
      }

      return {
        entries: data.results.map((r) => ({
          id: r.id,
          content: r.content,
          metadata: r.metadata,
          timestamp: Date.now(),
          relevance: r.score,
        })),
        query,
        totalResults: data.results.length,
      }
    } catch (err) {
      log.error("search failed", { error: err })
      // Fallback to local search
      const entries = Array.from(localMemory.values())
        .filter((entry) => entry.content.toLowerCase().includes(query.toLowerCase()))
        .slice(0, limit)

      return {
        entries,
        query,
        totalResults: entries.length,
      }
    }
  }

  export async function remove(key: string): Promise<boolean> {
    log.info("removing memory", { key: key.slice(0, 50) })

    const apiKey = process.env.MEM0_API_KEY
    if (!apiKey) {
      return localMemory.delete(key)
    }

    try {
      const response = await fetch(`${MEM0_API_URL}/v1/memories/${encodeURIComponent(key)}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })

      return response.ok
    } catch (err) {
      log.error("remove failed", { error: err })
      return localMemory.delete(key)
    }
  }

  export async function list(limit: number = 100): Promise<MemoryEntry[]> {
    log.info("listing memories", { limit })

    const apiKey = process.env.MEM0_API_KEY
    if (!apiKey) {
      return Array.from(localMemory.values()).slice(0, limit)
    }

    try {
      const response = await fetch(`${MEM0_API_URL}/v1/memories?limit=${limit}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })

      if (!response.ok) {
        throw new Error(`Mem0 list failed: ${response.statusText}`)
      }

      const data = (await response.json()) as {
        results: Array<{ id: string; content: string; metadata: Record<string, unknown> }>
      }

      return data.results.map((r) => ({
        id: r.id,
        content: r.content,
        metadata: r.metadata,
        timestamp: Date.now(),
      }))
    } catch (err) {
      log.error("list failed", { error: err })
      return Array.from(localMemory.values()).slice(0, limit)
    }
  }

  export async function clear(): Promise<void> {
    log.info("clearing all memories")

    const apiKey = process.env.MEM0_API_KEY
    if (!apiKey) {
      localMemory.clear()
      return
    }

    try {
      await fetch(`${MEM0_API_URL}/v1/memories`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })
    } catch (err) {
      log.error("clear failed", { error: err })
    }

    localMemory.clear()
  }

  export function getLocalMemorySize(): number {
    return localMemory.size
  }

  export async function storePhaseContext(
    phase: number,
    context: Record<string, unknown>,
  ): Promise<void> {
    const key = `phase-${phase}-context`
    await store(key, JSON.stringify(context), { phase, type: "context" })
  }

  export async function getPhaseContext(phase: number): Promise<Record<string, unknown> | undefined> {
    const key = `phase-${phase}-context`
    const content = await retrieve(key)
    if (content) {
      try {
        return JSON.parse(content)
      } catch {
        return undefined
      }
    }
    return undefined
  }

  export async function storeAgentMemory(
    agentId: string,
    memory: Record<string, unknown>,
  ): Promise<void> {
    const key = `agent-${agentId}-memory`
    await store(key, JSON.stringify(memory), { agentId, type: "agent-memory" })
  }

  export async function getAgentMemory(agentId: string): Promise<Record<string, unknown> | undefined> {
    const key = `agent-${agentId}-memory`
    const content = await retrieve(key)
    if (content) {
      try {
        return JSON.parse(content)
      } catch {
        return undefined
      }
    }
    return undefined
  }
}

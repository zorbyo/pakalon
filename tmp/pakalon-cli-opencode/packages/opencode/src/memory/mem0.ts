import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { Pakalon } from "../pakalon"

const log = Log.create({ service: "memory:mem0" })

export interface MemoryEntry {
  id: string
  key: string
  value: string
  phase: number
  sessionId: string
  tags: string[]
  createdAt: number
  updatedAt: number
}

export namespace Mem0 {
  const store = new Map<string, MemoryEntry>()

  export function store_entry(
    key: string,
    value: string,
    phase: number,
    sessionId: string,
    tags: string[] = [],
  ): MemoryEntry {
    const entry: MemoryEntry = {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      key,
      value,
      phase,
      sessionId,
      tags,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    store.set(entry.id, entry)
    log.info("stored memory", { key, phase })
    return entry
  }

  export function retrieve(key: string): MemoryEntry | undefined {
    for (const entry of store.values()) {
      if (entry.key === key) return entry
    }
    return undefined
  }

  export function search(query: string): MemoryEntry[] {
    const q = query.toLowerCase()
    return Array.from(store.values()).filter(
      (e) => e.key.toLowerCase().includes(q) || e.value.toLowerCase().includes(q),
    )
  }

  export function getByPhase(phase: number): MemoryEntry[] {
    return Array.from(store.values()).filter((e) => e.phase === phase)
  }

  export function getBySession(sessionId: string): MemoryEntry[] {
    return Array.from(store.values()).filter((e) => e.sessionId === sessionId)
  }

  export function getByTag(tag: string): MemoryEntry[] {
    return Array.from(store.values()).filter((e) => e.tags.includes(tag))
  }

  export function deleteEntry(id: string): boolean {
    return store.delete(id)
  }

  export function list(): MemoryEntry[] {
    return Array.from(store.values())
  }

  export async function save(projectPath: string): Promise<void> {
    const dir = Pakalon.agentsDir(projectPath)
    const p = `${dir}/memory.json`
    await Filesystem.writeJson(p, Array.from(store.values()))
  }

  export async function load(projectPath: string): Promise<void> {
    const dir = Pakalon.agentsDir(projectPath)
    const p = `${dir}/memory.json`
    try {
      const data = await Filesystem.readJson<MemoryEntry[]>(p)
      store.clear()
      for (const entry of data) {
        store.set(entry.id, entry)
      }
      log.info("loaded memory", { count: data.length })
    } catch {
      log.info("no existing memory found")
    }
  }

  export function contextForPhase(phase: number): string {
    const entries = getByPhase(phase)
    if (entries.length === 0) return ""
    return entries.map((e) => `## ${e.key}\n${e.value}`).join("\n\n")
  }

  export function crossPhaseContext(fromPhase: number, toPhase: number): string {
    const prev = getByPhase(fromPhase)
    if (prev.length === 0) return ""
    const lines = [`## Context from Phase ${fromPhase}`, ""]
    for (const entry of prev) {
      lines.push(`### ${entry.key}`)
      lines.push(entry.value)
      lines.push("")
    }
    return lines.join("\n")
  }
}

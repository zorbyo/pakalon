import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./store-memory.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { Global } from "../global"
import path from "path"

const log = Log.create({ service: "store-memory-tool" })

interface StoredMemory {
  id: string
  key: string
  value: string
  projectPath?: string
  createdAt: number
  updatedAt: number
}

function memoryFilePath(): string {
  return path.join(Global.Path.data, "memory.json")
}

async function loadMemories(): Promise<StoredMemory[]> {
  try {
    return await Filesystem.readJson<StoredMemory[]>(memoryFilePath())
  } catch {
    return []
  }
}

async function saveMemories(memories: StoredMemory[]): Promise<void> {
  await Filesystem.writeJson(memoryFilePath(), memories)
}

export const StoreMemoryTool = Tool.define("store_memory", {
  description: DESCRIPTION,
  parameters: z.object({
    key: z.string().describe("A descriptive key for the memory (e.g., 'user_preference_indentation', 'project_convention')"),
    value: z.string().describe("The information to remember"),
    scope: z
      .enum(["global", "project"])
      .optional()
      .describe("Scope of the memory: 'global' applies everywhere, 'project' is scoped to the current project. Defaults to 'global'."),
  }),
  async execute(params, ctx) {
    const memories = await loadMemories()
    const now = Date.now()

    const existing = memories.find((m) => m.key === params.key)
    if (existing) {
      existing.value = params.value
      existing.updatedAt = now
      if (params.scope === "project") {
        existing.projectPath = Instance.directory
      } else {
        existing.projectPath = undefined
      }
      await saveMemories(memories)
      log.info("updated memory", { key: params.key })
      return {
        title: "Updated memory",
        metadata: { key: params.key, action: "updated" },
        output: `Memory updated: "${params.key}" = "${params.value}"`,
      }
    }

    const memory: StoredMemory = {
      id: `mem-${now}-${Math.random().toString(36).slice(2, 8)}`,
      key: params.key,
      value: params.value,
      projectPath: params.scope === "project" ? Instance.directory : undefined,
      createdAt: now,
      updatedAt: now,
    }
    memories.push(memory)
    await saveMemories(memories)
    log.info("stored memory", { key: params.key, scope: params.scope ?? "global" })

    return {
      title: "Stored memory",
      metadata: { key: params.key, action: "stored" },
      output: `Memory stored: "${params.key}" = "${params.value}" (scope: ${params.scope ?? "global"})`,
    }
  },
})

export const RetrieveMemoryTool = Tool.define("retrieve_memory", {
  description:
    "Retrieve previously stored memories. Use this to recall user preferences, project conventions, or other context from past sessions.",
  parameters: z.object({
    query: z.string().describe("Search query to find relevant memories (searches keys and values)"),
  }),
  async execute(params, ctx) {
    const memories = await loadMemories()
    const q = params.query.toLowerCase()

    const matches = memories.filter(
      (m) =>
        m.key.toLowerCase().includes(q) ||
        m.value.toLowerCase().includes(q) ||
        (!m.projectPath || m.projectPath === Instance.directory),
    )

    if (matches.length === 0) {
      return {
        title: "No memories found",
        metadata: { query: params.query, count: 0 },
        output: `No memories found matching "${params.query}"`,
      }
    }

    const output = matches
      .map((m) => {
        const scope = m.projectPath ? `project (${m.projectPath})` : "global"
        return `- ${m.key}: ${m.value} [${scope}]`
      })
      .join("\n")

    return {
      title: `Found ${matches.length} memories`,
      metadata: { query: params.query, count: matches.length },
      output: `Found ${matches.length} memories matching "${params.query}":\n\n${output}`,
    }
  },
})

export const ListMemoriesTool = Tool.define("list_memories", {
  description: "List all stored memories. Use this to review what information has been remembered.",
  parameters: z.object({}),
  async execute(params, ctx) {
    const memories = await loadMemories()

    if (memories.length === 0) {
      return {
        title: "No memories stored",
        metadata: { count: 0 },
        output: "No memories have been stored yet. Use store_memory to save important information for future sessions.",
      }
    }

    const output = memories
      .map((m) => {
        const scope = m.projectPath ? `project (${m.projectPath})` : "global"
        const date = new Date(m.updatedAt).toLocaleDateString()
        return `- ${m.key}: ${m.value} [${scope}, updated ${date}]`
      })
      .join("\n")

    return {
      title: `${memories.length} memories`,
      metadata: { count: memories.length },
      output: `Stored memories (${memories.length}):\n\n${output}`,
    }
  },
})

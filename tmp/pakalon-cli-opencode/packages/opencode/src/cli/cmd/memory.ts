import { cmd } from "./cmd"
import { UI } from "../ui"
import path from "path"
import { Global } from "../../global"
import { Filesystem } from "../../util/filesystem"

interface MemoryArgs {
  list?: boolean
  clear?: boolean
  search?: string
  limit?: number
  json?: boolean
  project?: boolean
}

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

export const MemoryCommand = cmd({
  command: "memory",
  describe: "Manage conversation memory",
  builder: (yargs) =>
    yargs
      .option("list", {
        type: "boolean",
        alias: "l",
        describe: "List stored memories",
      })
      .option("clear", {
        type: "boolean",
        alias: "c",
        describe: "Clear all memories",
      })
      .option("search", {
        type: "string",
        alias: "s",
        describe: "Search memories",
      })
      .option("limit", {
        type: "number",
        alias: "n",
        default: 50,
        describe: "Maximum number of memory entries to return",
      })
      .option("project", {
        type: "boolean",
        default: false,
        describe: "Only show or clear memories scoped to current project",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output JSON",
      }),
  async handler(args: MemoryArgs) {
    const all = await loadMemories()
    const projectPath = process.cwd()
    const inScope = args.project ? all.filter((m) => m.projectPath === projectPath) : all

    if (args.clear) {
      if (args.project) {
        const kept = all.filter((m) => m.projectPath !== projectPath)
        const removed = all.length - kept.length
        await saveMemories(kept)
        if (args.json) {
          console.log(JSON.stringify({ cleared: removed, scope: "project", projectPath }, null, 2))
          return
        }
        UI.println(UI.Style.TEXT_SUCCESS + `✓ Cleared ${removed} project memories`)
        return
      }

      await saveMemories([])
      if (args.json) {
        console.log(JSON.stringify({ cleared: all.length, scope: "all" }, null, 2))
        return
      }
      UI.println(UI.Style.TEXT_SUCCESS + `✓ Cleared ${all.length} memories`)
      return
    }

    const limit = Math.max(1, args.limit || 50)

    if (args.search) {
      const q = args.search.toLowerCase()
      const matches = inScope
        .filter((m) => m.key.toLowerCase().includes(q) || m.value.toLowerCase().includes(q))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit)

      if (args.json) {
        console.log(JSON.stringify({ query: args.search, count: matches.length, entries: matches }, null, 2))
        return
      }

      UI.println(UI.Style.TEXT_INFO + `Search: ${args.search}`)
      UI.empty()
      if (matches.length === 0) {
        UI.println(UI.Style.TEXT_DIM + "No memories found matching query.")
        return
      }

      for (const memory of matches) {
        const scope = memory.projectPath ? `project (${memory.projectPath})` : "global"
        UI.println(`${UI.Style.TEXT_INFO}${memory.key}:${UI.Style.TEXT_NORMAL}`)
        UI.println(`  ${memory.value}`)
        UI.println(
          `  ${UI.Style.TEXT_DIM}[${scope}] updated ${new Date(memory.updatedAt).toLocaleString()}${UI.Style.TEXT_NORMAL}`,
        )
        UI.empty()
      }

      UI.println(UI.Style.TEXT_DIM + `Total matches: ${matches.length}`)
      return
    }

    const memories = inScope.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            scope: args.project ? "project" : "all",
            projectPath,
            count: memories.length,
            entries: memories,
          },
          null,
          2,
        ),
      )
      return
    }

    UI.println(UI.Style.TEXT_HIGHLIGHT + "Stored Memories")
    UI.empty()

    if (memories.length === 0) {
      UI.println(UI.Style.TEXT_DIM + "No memories stored.")
      UI.println(UI.Style.TEXT_DIM + "Memories are automatically created from conversations.")
      return
    }

    for (const memory of memories) {
      const scope = memory.projectPath ? `project (${memory.projectPath})` : "global"
      UI.println(`${UI.Style.TEXT_INFO}${memory.key}:${UI.Style.TEXT_NORMAL}`)
      UI.println(`  ${memory.value}`)
      UI.println(
        `  ${UI.Style.TEXT_DIM}[${scope}] updated ${new Date(memory.updatedAt).toLocaleString()}${UI.Style.TEXT_NORMAL}`,
      )
      UI.empty()
    }

    UI.println(UI.Style.TEXT_DIM + `Total: ${memories.length} memories`)
    UI.println(UI.Style.TEXT_DIM + "Use --search to filter, --clear to remove entries")
  },
})

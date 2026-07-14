import fs from "fs/promises"
import path from "path"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Global } from "../../global"
import { Plan } from "../../auth/plan"
import { resetClient } from "../../backend/client"
import { ModelsDev } from "../../provider/models"
import { ResearchEngine } from "../../pakalon/research"

interface BreakCacheArgs {
  dryRun?: boolean
  json?: boolean
}

async function listCacheEntries(cacheDir: string): Promise<string[]> {
  const entries = await fs.readdir(cacheDir, { withFileTypes: true }).catch(() => [])
  return entries.map((entry) => path.join(cacheDir, entry.name))
}

export const BreakCacheCommand = cmd({
  command: "break-cache",
  describe: "clear global cache directory and reset in-memory caches",
  builder: (yargs) =>
    yargs
      .option("dry-run", {
        alias: "n",
        type: "boolean",
        default: false,
        describe: "Show what would be removed without deleting anything",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output JSON",
      }),
  handler: async (rawArgs) => {
    const args: BreakCacheArgs = {
      dryRun: Boolean(rawArgs.dryRun),
      json: Boolean(rawArgs.json),
    }

    const cacheDir = Global.Path.cache
    const entries = await listCacheEntries(cacheDir)

    if (!args.dryRun) {
      for (const entryPath of entries) {
        await fs.rm(entryPath, { force: true, recursive: true }).catch(() => undefined)
      }

      Plan.clearCache()
      resetClient()
      ModelsDev.Data.reset()
      ResearchEngine.clearCache()
    }

    const payload = {
      cacheDir,
      dryRun: args.dryRun,
      removedEntries: args.dryRun ? [] : entries,
      entryCount: entries.length,
      resetInMemoryCaches: !args.dryRun,
      timestamp: new Date().toISOString(),
    }

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2))
      return
    }

    UI.println(UI.Style.TEXT_HIGHLIGHT + "Break Cache" + UI.Style.TEXT_NORMAL)
    UI.empty()

    if (entries.length === 0) {
      UI.println("No cache entries found.")
      return
    }

    UI.println(`Cache dir: ${cacheDir}`)
    UI.println(`Entries: ${entries.length}`)
    for (const entry of entries) UI.println(`- ${entry}`)

    UI.empty()
    if (args.dryRun) {
      UI.println(UI.Style.TEXT_WARNING + "Dry run only — nothing removed." + UI.Style.TEXT_NORMAL)
    } else {
      UI.println(UI.Style.TEXT_SUCCESS + "✓ Cache cleared and memory caches reset." + UI.Style.TEXT_NORMAL)
    }
  },
})

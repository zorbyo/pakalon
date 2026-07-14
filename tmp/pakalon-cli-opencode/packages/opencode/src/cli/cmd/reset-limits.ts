import fs from "fs/promises"
import path from "path"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Plan } from "../../auth/plan"
import { resetClient } from "../../backend/client"
import { ModelsDev } from "../../provider/models"
import { ResearchEngine } from "../../pakalon/research"
import { Global } from "../../global"
import { clearRateLimitMockState, getRateLimitMockFilePath } from "./rate-limit-state"

interface ResetLimitsArgs {
  all?: boolean
  json?: boolean
}

async function removeFileIfExists(filePath: string): Promise<boolean> {
  try {
    await fs.rm(filePath, { force: true })
    return true
  } catch {
    return false
  }
}

export const ResetLimitsCommand = cmd({
  command: "reset-limits",
  describe: "reset local limit-related state (rate-limit mocks, backend/session caches)",
  builder: (yargs) =>
    yargs
      .option("all", {
        type: "boolean",
        default: false,
        describe: "Also clear cached model files from global cache",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output JSON",
      }),
  handler: async (rawArgs) => {
    const args: ResetLimitsArgs = {
      all: Boolean(rawArgs.all),
      json: Boolean(rawArgs.json),
    }

    const cleared: string[] = []

    Plan.clearCache()
    cleared.push("plan-cache")

    resetClient()
    cleared.push("backend-client")

    ModelsDev.Data.reset()
    cleared.push("models-dev-memory")

    ResearchEngine.clearCache()
    cleared.push("research-memory")

    await clearRateLimitMockState()
    cleared.push("mock-limits-state")

    if (args.all) {
      const maybeCacheFiles = [
        path.join(Global.Path.cache, "models.json"),
        path.join(Global.Path.cache, "openrouter-models.json"),
        getRateLimitMockFilePath(),
      ]

      const removed = await Promise.all(maybeCacheFiles.map(removeFileIfExists))
      for (let i = 0; i < maybeCacheFiles.length; i++) {
        if (!removed[i]) continue
        cleared.push(`file:${maybeCacheFiles[i]}`)
      }
    }

    const payload = {
      ok: true,
      all: args.all,
      cleared,
      timestamp: new Date().toISOString(),
    }

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2))
      return
    }

    UI.println(UI.Style.TEXT_HIGHLIGHT + "Reset Limits" + UI.Style.TEXT_NORMAL)
    UI.empty()
    UI.println(UI.Style.TEXT_SUCCESS + "✓ Limit-related state reset" + UI.Style.TEXT_NORMAL)
    for (const item of cleared) {
      UI.println(`- ${item}`)
    }
  },
})

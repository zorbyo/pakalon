import type { Argv } from "yargs"
import { Instance } from "../../project/instance"
import { Provider } from "../../provider/provider"
import { ProviderID } from "../../provider/schema"
import { ModelsDev } from "../../provider/models"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { EOL } from "os"
import * as Backend from "../../backend"

export const ModelsCommand = cmd({
  command: "models [provider]",
  describe: "list all available models",
  builder: (yargs: Argv) => {
    return yargs
      .positional("provider", {
        describe: "provider ID to filter models by",
        type: "string",
        array: false,
      })
      .option("verbose", {
        describe: "use more verbose model output (includes metadata like costs)",
        type: "boolean",
      })
      .option("refresh", {
        describe: "refresh the models cache from models.dev",
        type: "boolean",
      })
  },
  handler: async (args) => {
    if (args.refresh) {
      await ModelsDev.refresh()
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Models cache refreshed" + UI.Style.TEXT_NORMAL)
    }

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        if (Backend.isBackendEnabled() && (!args.provider || args.provider === "pakalon")) {
          const result = await Backend.ModelsBackend.listModels(args.verbose ? true : false)
          const plan = result.plan === "pro" ? "pro" : "free"
          const visibleModels = Backend.ModelsBackend.filterByPlan(result.models, plan)
          const sorted = [...visibleModels].sort((a, b) => {
            const aID = a.id ?? a.model_id ?? a.name
            const bID = b.id ?? b.model_id ?? b.name
            return aID.localeCompare(bID)
          })

          for (const model of sorted) {
            const modelID = model.id ?? model.model_id ?? model.name
            const suffix =
              model.remaining_pct !== undefined
                ? ` (${Math.max(0, Math.min(100, Math.round(model.remaining_pct)))}% remaining)`
                : ""
            process.stdout.write(`${modelID}${suffix}`)
            process.stdout.write(EOL)
            if (args.verbose) {
              process.stdout.write(JSON.stringify(model, null, 2))
              process.stdout.write(EOL)
            }
          }
          return
        }

        const providers = await Provider.list()

        function printModels(providerID: ProviderID, verbose?: boolean) {
          const provider = providers[providerID]
          const sortedModels = Object.entries(provider.models).sort(([a], [b]) => a.localeCompare(b))
          for (const [modelID, model] of sortedModels) {
            process.stdout.write(`${providerID}/${modelID}`)
            process.stdout.write(EOL)
            if (verbose) {
              process.stdout.write(JSON.stringify(model, null, 2))
              process.stdout.write(EOL)
            }
          }
        }

        if (args.provider) {
          const provider = providers[args.provider]
          if (!provider) {
            UI.error(`Provider not found: ${args.provider}`)
            return
          }

          printModels(ProviderID.make(args.provider), args.verbose)
          return
        }

        const providerIDs = Object.keys(providers).sort((a, b) => {
          const aIsPakalon = a.startsWith("pakalon")
          const bIsPakalon = b.startsWith("pakalon")
          if (aIsPakalon && !bIsPakalon) return -1
          if (!aIsPakalon && bIsPakalon) return 1
          return a.localeCompare(b)
        })

        for (const providerID of providerIDs) {
          printModels(ProviderID.make(providerID), args.verbose)
        }
      },
    })
  },
})

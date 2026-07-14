import { Agent } from "../../agent/agent"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { cmd } from "./cmd"

interface EffortArgs {
  level?: string
  status?: boolean
  agent?: string
}

const PRIORITY = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "thinking"]

function normalize(value?: string) {
  return value?.trim().toLowerCase()
}

function sortVariants(values: string[]) {
  return [...values].sort((a, b) => {
    const ai = PRIORITY.indexOf(a)
    const bi = PRIORITY.indexOf(b)
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    }
    return a.localeCompare(b)
  })
}

function describe(level: string) {
  switch (level) {
    case "none":
      return "No explicit reasoning effort."
    case "minimal":
      return "Minimal reasoning effort for fastest responses."
    case "low":
      return "Quick responses with lightweight reasoning."
    case "medium":
      return "Balanced reasoning effort for most tasks."
    case "high":
      return "Deeper reasoning for harder tasks."
    case "xhigh":
      return "Extra-high reasoning effort (provider-dependent)."
    case "max":
      return "Maximum supported reasoning effort for this model."
    case "thinking":
      return "Enable provider-specific thinking mode."
    default:
      return "Custom model variant enabled."
  }
}

export const EffortCommand = cmd({
  command: "effort [level]",
  describe: "set or inspect reasoning effort level",
  builder: (yargs) =>
    yargs
      .positional("level", {
        type: "string",
        describe: "Effort level/variant to set (for example: low, medium, high, max)",
      })
      .option("status", {
        alias: "s",
        type: "boolean",
        default: false,
        describe: "Show current effort settings",
      })
      .option("agent", {
        type: "string",
        describe: "Agent to configure (defaults to current default agent)",
      }),
  handler: async (args: EffortArgs) => {
    await bootstrap(process.cwd(), async () => {
      const requested = normalize(args.level)
      const modelRef = await Provider.defaultModel()
      const model = await Provider.getModel(modelRef.providerID, modelRef.modelID)

      const availableVariants = sortVariants(Object.keys(model.variants ?? {}))
      const agentName = normalize(args.agent) ?? (await Agent.defaultAgent().catch(() => "build"))
      const agent = await Agent.get(agentName)

      if (!agent) {
        UI.error(`Agent not found: ${agentName}`)
        return
      }

      const config = await Config.get()
      const configured = config.agent?.[agentName]?.variant
      const active = configured && model.variants?.[configured] ? configured : undefined

      const showStatus = Boolean(args.status) || !requested

      if (showStatus) {
        UI.println(UI.Style.TEXT_HIGHLIGHT + "Effort Settings" + UI.Style.TEXT_NORMAL)
        UI.empty()
        UI.println(`Agent: ${agentName}`)
        UI.println(`Model: ${model.providerID}/${model.id}`)
        UI.println(`Reasoning support: ${model.capabilities.reasoning ? "yes" : "no"}`)
        UI.println(`Configured effort: ${configured ?? "(not set)"}`)
        UI.println(`Active effort: ${active ?? "(model default)"}`)

        if (availableVariants.length === 0) {
          UI.println(UI.Style.TEXT_DIM + "This model does not expose configurable effort variants." + UI.Style.TEXT_NORMAL)
          UI.println(UI.Style.TEXT_DIM + "Tip: pick a reasoning-capable model, then run `pakalon effort <level>`." + UI.Style.TEXT_NORMAL)
        } else {
          UI.println(`Available levels: ${availableVariants.join(", ")}`)
        }

        if (configured && !active) {
          UI.println(
            UI.Style.TEXT_WARNING +
              `Configured effort \"${configured}\" is not available for the current model.` +
              UI.Style.TEXT_NORMAL,
          )
        }

        if (!requested) {
          return
        }
      }

      if (!requested) {
        return
      }

      if (!model.capabilities.reasoning || availableVariants.length === 0) {
        UI.error("Current model does not support configurable effort levels.")
        return
      }

      if (!availableVariants.includes(requested)) {
        UI.error(`Effort level \"${requested}\" is not available for ${model.providerID}/${model.id}.`)
        UI.println(UI.Style.TEXT_DIM + `Available levels: ${availableVariants.join(", ")}` + UI.Style.TEXT_NORMAL)
        return
      }

      await Config.updateGlobal({
        agent: {
          [agentName]: {
            variant: requested,
          },
        },
      })

      UI.println(UI.Style.TEXT_SUCCESS + `✓ Effort set to ${requested}` + UI.Style.TEXT_NORMAL)
      UI.println(UI.Style.TEXT_DIM + describe(requested) + UI.Style.TEXT_NORMAL)
      UI.println(UI.Style.TEXT_DIM + `Applies to agent \"${agentName}\" when the current model supports this variant.` + UI.Style.TEXT_NORMAL)
    })
  },
})

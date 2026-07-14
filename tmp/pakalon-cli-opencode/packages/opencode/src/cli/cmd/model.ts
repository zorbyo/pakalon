import { cmd } from "./cmd"
import { UI } from "../ui"
import { Config } from "@/config/config"

interface ModelArgs {
  model?: string
  list?: boolean
}

const AVAILABLE_MODELS = [
  { id: "claude-sonnet-4", provider: "anthropic", name: "Claude Sonnet 4" },
  { id: "claude-opus-4", provider: "anthropic", name: "Claude Opus 4" },
  { id: "claude-haiku-4", provider: "anthropic", name: "Claude Haiku 4" },
  { id: "gpt-4o", provider: "openai", name: "GPT-4o" },
  { id: "gpt-4o-mini", provider: "openai", name: "GPT-4o Mini" },
  { id: "o1", provider: "openai", name: "o1" },
  { id: "o1-mini", provider: "openai", name: "o1-mini" },
  { id: "gemini-pro", provider: "google", name: "Gemini Pro" },
]

export const ModelCommand = cmd({
  command: "model [model]",
  describe: "Switch the AI model",
  builder: (yargs) =>
    yargs
      .positional("model", {
        type: "string",
        describe: "Model ID to switch to",
      })
      .option("list", {
        type: "boolean",
        alias: "l",
        describe: "List available models",
      }),
  async handler(args: ModelArgs) {
    // List models
    if (args.list || !args.model) {
      UI.println(UI.Style.TEXT_HIGHLIGHT + "Available Models")
      UI.empty()

      const currentModel = process.env.PAKALON_MODEL || "claude-sonnet-4"
      
      const byProvider: Record<string, typeof AVAILABLE_MODELS> = {}
      for (const model of AVAILABLE_MODELS) {
        if (!byProvider[model.provider]) {
          byProvider[model.provider] = []
        }
        byProvider[model.provider].push(model)
      }

      for (const [provider, models] of Object.entries(byProvider)) {
        UI.println(UI.Style.TEXT_INFO + provider.toUpperCase() + ":")
        for (const model of models) {
          const isCurrent = model.id === currentModel
          const marker = isCurrent ? UI.Style.TEXT_SUCCESS + "→ " : "  "
          const suffix = isCurrent ? " (current)" : ""
          UI.println(`${marker}${model.id.padEnd(20)}${UI.Style.RESET}${model.name}${suffix}`)
        }
        UI.empty()
      }

      UI.println(UI.Style.TEXT_DIM + "Use /model <model-id> to switch")
      return
    }

    // Switch model
    const model = AVAILABLE_MODELS.find(m => m.id === args.model)
    
    if (!model) {
      UI.println(UI.Style.TEXT_ERROR + `Unknown model: ${args.model}`)
      UI.println(UI.Style.TEXT_DIM + "Use /model --list to see available models")
      return
    }

    try {
      await Config.set("model", model.id)
      await Config.set("provider", model.provider)
      
      UI.println(UI.Style.TEXT_SUCCESS + `✓ Switched to ${model.name} (${model.id})`)
      UI.println(UI.Style.TEXT_DIM + `Provider: ${model.provider}`)

    } catch (error) {
      UI.println(UI.Style.TEXT_ERROR + `Failed to switch model: ${error}`)
    }
  },
})

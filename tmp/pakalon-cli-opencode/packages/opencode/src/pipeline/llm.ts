import { Log } from "../util/log"
import { generateText } from "ai"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { Config } from "../config/config"
import { Filesystem } from "../util/filesystem"
import path from "path"

const log = Log.create({ service: "pipeline:llm" })

export interface PhaseLLMOptions {
  systemPrompt: string
  userPrompt: string
  modelId?: string
  providerId?: string
  maxTokens?: number
  temperature?: number
}

export namespace PhaseLLM {
  /**
   * Generate text using the configured LLM model.
   * Phase executors use this to generate tailored artifacts instead of templates.
   */
  export async function generate(options: PhaseLLMOptions): Promise<string> {
    const { systemPrompt, userPrompt, maxTokens = 4096, temperature = 0.7 } = options

    try {
      // Resolve model - use provided or get default
      const modelId = options.modelId ?? await getDefaultModel()
      const providerId = options.providerId ?? "pakalon"

      const model = await Provider.getModel(ProviderID.make(providerId), ModelID.make(modelId))

      log.info("generating with LLM", { modelId, providerId })

      const language = await Provider.getLanguage(model)

      const result = await generateText({
        model: language,
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: maxTokens,
        temperature,
      })

      log.info("LLM generation complete", { length: result.text.length })
      return result.text
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      log.error("LLM generation failed, falling back to template", { error })
      return ""
    }
  }

  /**
   * Generate with project context - reads relevant files and includes them.
   */
  export async function generateWithContext(
    options: PhaseLLMOptions & { projectPath: string; contextFiles?: string[] }
  ): Promise<string> {
    const { projectPath, contextFiles = [], ...rest } = options

    // Build context from files
    let contextSection = ""
    if (contextFiles.length > 0) {
      const parts: string[] = []
      for (const file of contextFiles) {
        try {
          const filePath = path.isAbsolute(file) ? file : path.join(projectPath, file)
          const content = await Filesystem.readText(filePath)
          if (content) {
            parts.push(`### ${filePath}\n\`\`\`\n${content.slice(0, 2000)}\n\`\`\``)
          }
        } catch {
          // Skip unreadable files
        }
      }
      if (parts.length > 0) {
        contextSection = `\n\n## Project Context\n${parts.join("\n\n")}`
      }
    }

    return generate({
      ...rest,
      userPrompt: rest.userPrompt + contextSection,
    })
  }

  async function getDefaultModel(): Promise<string> {
    try {
      const config = await Config.get()
      return config.model ?? "nvidia/nemotron-3-super-120b-a12b:free"
    } catch {
      return "nvidia/nemotron-3-super-120b-a12b:free"
    }
  }
}

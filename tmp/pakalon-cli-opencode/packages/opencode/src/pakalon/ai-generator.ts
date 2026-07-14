import { generateText } from "ai"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"

const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free"

export async function generateWithAI(prompt: string, context: string): Promise<string> {
  const selected = await Provider.defaultModel().catch(() => ({
    providerID: ProviderID.openrouter,
    modelID: ModelID.make(DEFAULT_MODEL),
  }))
  const model = await Provider.getModel(selected.providerID, selected.modelID)
  const language = await Provider.getLanguage(model)

  const result = await generateText({
    model: language,
    system:
      "You are Pakalon's phase generation engine. Produce practical, project-specific markdown only. No placeholders.",
    prompt: `${prompt}\n\n## Project Context\n${context}`,
    temperature: 0.4,
    maxOutputTokens: 2400,
  })

  return result.text.trim()
}

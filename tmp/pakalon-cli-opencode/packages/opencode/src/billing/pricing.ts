import { Log } from "../util/log"

const log = Log.create({ service: "billing:pricing" })

export interface ModelPricing {
  modelId: string
  inputCostPer1M: number
  outputCostPer1M: number
  isFree: boolean
}

const PRICING_TABLE: Record<string, ModelPricing> = {
  "openai/gpt-4o": { modelId: "openai/gpt-4o", inputCostPer1M: 2.5, outputCostPer1M: 10, isFree: false },
  "openai/gpt-4o-mini": { modelId: "openai/gpt-4o-mini", inputCostPer1M: 0.15, outputCostPer1M: 0.6, isFree: false },
  "anthropic/claude-sonnet-4": { modelId: "anthropic/claude-sonnet-4", inputCostPer1M: 3, outputCostPer1M: 15, isFree: false },
  "anthropic/claude-haiku-3.5": { modelId: "anthropic/claude-haiku-3.5", inputCostPer1M: 0.8, outputCostPer1M: 4, isFree: false },
  "google/gemini-2.0-flash": { modelId: "google/gemini-2.0-flash", inputCostPer1M: 0.1, outputCostPer1M: 0.4, isFree: false },
}

const PLATFORM_FEE = 0.1

export namespace Pricing {
  export function get(modelId: string): ModelPricing | undefined {
    return PRICING_TABLE[modelId]
  }

  export function calculateCost(modelId: string, inputTokens: number, outputTokens: number): number {
    const pricing = PRICING_TABLE[modelId]
    if (!pricing) return 0
    if (pricing.isFree) return 0
    const inputCost = (inputTokens / 1_000_000) * pricing.inputCostPer1M
    const outputCost = (outputTokens / 1_000_000) * pricing.outputCostPer1M
    const baseCost = inputCost + outputCost
    return baseCost * (1 + PLATFORM_FEE)
  }

  export function isFree(modelId: string): boolean {
    return modelId.includes(":free") || PRICING_TABLE[modelId]?.isFree === true
  }

  export function addPricing(pricing: ModelPricing): void {
    PRICING_TABLE[pricing.modelId] = pricing
    log.info("added model pricing", { model: pricing.modelId })
  }

  export function list(): ModelPricing[] {
    return Object.values(PRICING_TABLE)
  }

  export function freeModels(): ModelPricing[] {
    return Object.values(PRICING_TABLE).filter((p) => p.isFree)
  }

  export function proModels(): ModelPricing[] {
    return Object.values(PRICING_TABLE).filter((p) => !p.isFree)
  }

  export function formatCost(cost: number): string {
    if (cost < 0.01) return `$${cost.toFixed(6)}`
    return `$${cost.toFixed(4)}`
  }
}

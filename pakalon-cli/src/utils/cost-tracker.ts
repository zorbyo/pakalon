import { calculateCost, estimateTokens, type TokenUsage } from './cost-estimate.js'
import { logEvent } from './telemetry/events.js'

export interface CostTrackingSnapshot {
  modelId: string
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
  totalTokens: number
}

export class CostTracker {
  private inputTokens = 0
  private outputTokens = 0
  private totalCostUsd = 0

  recordUsage(modelId: string, usage: TokenUsage): CostTrackingSnapshot {
    const inputTokens = usage.input_tokens ?? 0
    const outputTokens = usage.output_tokens ?? 0
    const { totalCost } = calculateCost(modelId, inputTokens, outputTokens)

    this.inputTokens += inputTokens
    this.outputTokens += outputTokens
    this.totalCostUsd += totalCost

    const snapshot = this.snapshot(modelId)
    logEvent('cost.tracked', { payload: snapshot })
    return snapshot
  }

  estimateFromText(modelId: string, prompt: string, completion = ''): CostTrackingSnapshot {
    return this.recordUsage(modelId, {
      input_tokens: estimateTokens(prompt),
      output_tokens: estimateTokens(completion),
    })
  }

  snapshot(modelId = 'unknown'): CostTrackingSnapshot {
    return {
      modelId,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      estimatedCostUsd: this.totalCostUsd,
      totalTokens: this.inputTokens + this.outputTokens,
    }
  }

  reset(): void {
    this.inputTokens = 0
    this.outputTokens = 0
    this.totalCostUsd = 0
  }
}

export const costTracker = new CostTracker()

export function recordCostUsage(modelId: string, usage: TokenUsage): CostTrackingSnapshot {
  return costTracker.recordUsage(modelId, usage)
}

export function predictCostFromText(
  modelId: string,
  prompt: string,
  completion = '',
): CostTrackingSnapshot {
  return costTracker.estimateFromText(modelId, prompt, completion)
}

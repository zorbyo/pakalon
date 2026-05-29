import { logEvent } from './telemetry/events.js'
import { costTracker, recordCostUsage, type CostTrackingSnapshot } from './cost-tracker.js'
import { type TokenUsage } from './cost-estimate.js'

export interface UsageCreditState {
  totalCredits: number
  usedCredits: number
  remainingCredits: number
  utilization: number
  exhausted: boolean
}

export interface UsageMonitorOptions {
  modelId: string
  usage: TokenUsage
  creditLimit?: number
}

export function getUsageCreditState(
  usedCredits: number,
  totalCredits = 0,
): UsageCreditState {
  const remainingCredits = Math.max(0, totalCredits - usedCredits)
  const utilization = totalCredits > 0 ? usedCredits / totalCredits : 0
  return {
    totalCredits,
    usedCredits,
    remainingCredits,
    utilization,
    exhausted: totalCredits > 0 ? usedCredits >= totalCredits : false,
  }
}

export function monitorUsage(options: UsageMonitorOptions): {
  snapshot: CostTrackingSnapshot
  creditState: UsageCreditState
} {
  const snapshot = recordCostUsage(options.modelId, options.usage)
  const creditLimit = options.creditLimit ?? 0
  const creditState = getUsageCreditState(snapshot.estimatedCostUsd, creditLimit)

  logEvent('usage.monitored', {
    payload: {
      modelId: options.modelId,
      totalTokens: snapshot.totalTokens,
      estimatedCostUsd: snapshot.estimatedCostUsd,
      remainingCredits: creditState.remainingCredits,
      utilization: creditState.utilization,
    },
  })

  return { snapshot, creditState }
}

export function getUsageSummary(): CostTrackingSnapshot {
  return costTracker.snapshot()
}

export function resetUsageTracking(): void {
  costTracker.reset()
  logEvent('usage.reset')
}

export function checkUsageThreshold(
  usage: UsageCreditState,
  threshold = 0.8,
): boolean {
  return usage.utilization >= threshold
}

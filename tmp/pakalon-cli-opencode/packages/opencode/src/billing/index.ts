import { Usage } from "./usage"
import { Pricing } from "./pricing"
import { Polar } from "./polar"
import { Notifications } from "./notifications"
import { Log } from "../util/log"

const log = Log.create({ service: "billing" })

export namespace Billing {
  export async function init(): Promise<void> {
    await Usage.load()
    log.info("billing system initialized")
  }

  export function trackUsage(
    sessionId: string,
    modelId: string,
    providerId: string,
    inputTokens: number,
    outputTokens: number,
  ): void {
    const cost = Pricing.calculateCost(modelId, inputTokens, outputTokens)
    Usage.record({
      sessionId,
      modelId,
      providerId,
      inputTokens,
      outputTokens,
      cost,
      timestamp: Date.now(),
    })
  }

  export async function getUsageSummary(periodDays = 30): Promise<ReturnType<typeof Usage.summary>> {
    const now = Date.now()
    const start = now - periodDays * 24 * 60 * 60 * 1000
    return Usage.summary(start, now)
  }

  export function formatUsage(): string {
    const summary = Usage.summary()
    return Usage.formatSummary(summary)
  }
}

export { Usage } from "./usage"
export { Pricing } from "./pricing"
export { Polar } from "./polar"
export { Notifications } from "./notifications"

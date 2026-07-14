import { Log } from "../util/log"
import { getClient } from "./client"
import type {
  UsageResponse,
  HeatmapResponse,
  CreditBalanceResponse,
  CreditHistoryResponse,
  StartupCheckApiResponse,
  StartupCheckResponse,
} from "./types"

const log = Log.create({ service: "backend:usage" })

export namespace UsageBackend {
  export async function getUsage(): Promise<UsageResponse> {
    const client = getClient()
    log.info("fetching usage")
    const response = await client.get<UsageResponse>("/usage")
    log.info("usage fetched", {
      plan: response.plan,
      tokens: response.total_tokens,
      sessions: response.sessions_count,
    })
    return response
  }

  export async function getHeatmap(year?: number): Promise<HeatmapResponse> {
    const client = getClient()
    const params = year ? `?year=${year}` : ""
    log.info("fetching heatmap", { year })
    const response = await client.get<HeatmapResponse>(`/usage/heatmap${params}`)
    log.info("heatmap fetched", { year: response.year, contributions: response.contributions.length })
    return response
  }

  export async function getCreditsBalance(): Promise<CreditBalanceResponse> {
    const client = getClient()
    log.info("fetching credit balance")
    const response = await client.get<CreditBalanceResponse>("/credits/balance")
    log.info("credit balance fetched", {
      remaining: response.credits_remaining,
      total: response.credits_total,
      plan: response.plan,
    })
    return response
  }

  export async function getCreditsHistory(): Promise<CreditHistoryResponse> {
    const client = getClient()
    log.info("fetching credit history")
    const response = await client.get<CreditHistoryResponse>("/credits/history")
    log.info("credit history fetched", { count: response.length })
    return response
  }

  export async function checkStartup(): Promise<StartupCheckResponse> {
    const client = getClient()
    log.info("checking startup eligibility")
    const response = await client.get<StartupCheckApiResponse>("/credits/startup-check")
    const normalized: StartupCheckResponse = {
      allowed: response.can_interact,
      reason: response.reason,
      credits_remaining: response.credits_remaining,
      plan: response.plan,
    }
    log.info("startup check result", {
      allowed: normalized.allowed,
      reason: normalized.reason,
      remaining: normalized.credits_remaining,
      plan: normalized.plan,
    })
    return normalized
  }

  export async function canStart(): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const result = await checkStartup()
      return { allowed: result.allowed, reason: result.reason }
    } catch (error) {
      log.warn("startup check failed, allowing by default", { error })
      return { allowed: true }
    }
  }
}

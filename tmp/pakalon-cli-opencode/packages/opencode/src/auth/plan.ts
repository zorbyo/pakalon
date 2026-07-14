import { Log } from "../util/log"
import * as Backend from "../backend"

const log = Log.create({ service: "auth:plan" })

export interface UserPlan {
  plan: "free" | "pro"
  credits: number
  canAccessPro: boolean
  availableModels: string[]
  trialDaysRemaining: number
}

let cachedPlan: UserPlan | null = null
let planCacheTime = 0
const PLAN_CACHE_TTL = 60000

export namespace Plan {
  export async function getUserPlan(): Promise<UserPlan> {
    if (!Backend.isBackendEnabled()) {
      return {
        plan: "free",
        credits: 0,
        canAccessPro: false,
        availableModels: [],
        trialDaysRemaining: 0,
      }
    }

    const now = Date.now()
    if (cachedPlan && now - planCacheTime < PLAN_CACHE_TTL) {
      return cachedPlan
    }

    try {
      const [usage, models, creditBalance] = await Promise.all([
        Backend.UsageBackend.getUsage(),
        Backend.ModelsBackend.listModels(),
        Backend.UsageBackend.getCreditsBalance().catch(() => undefined),
      ])

      cachedPlan = {
        plan: usage.plan as "free" | "pro",
        credits: creditBalance?.credits_remaining ?? 0,
        canAccessPro: usage.plan === "pro",
        availableModels: models.models
          .map((m) => m.id ?? m.model_id ?? m.name)
          .filter((value): value is string => Boolean(value)),
        trialDaysRemaining: usage.trial_days_remaining,
      }
      planCacheTime = now

      log.info("user plan fetched", {
        plan: cachedPlan.plan,
        modelCount: cachedPlan.availableModels.length,
      })

      return cachedPlan
    } catch (error) {
      log.warn("failed to fetch user plan from backend, using defaults", { error })
      return {
        plan: "free",
        credits: 0,
        canAccessPro: false,
        availableModels: [],
        trialDaysRemaining: 0,
      }
    }
  }

  export async function canUseModel(modelId: string): Promise<boolean> {
    if (!Backend.isBackendEnabled()) return false

    const plan = await getUserPlan()
    if (plan.plan === "pro") return true
    
    try {
      const models = await Backend.ModelsBackend.listModels()
      const model = models.models.find((m) => m.id === modelId || m.model_id === modelId || m.name === modelId)
      return model ? Backend.ModelsBackend.isFreeModel(model) : false
    } catch {
      return false
    }
  }

  export async function checkCredits(requiredCredits: number): Promise<boolean> {
    const plan = await getUserPlan()
    return plan.credits >= requiredCredits
  }

  export function filterModelsByPlan(models: string[], plan: "free" | "pro"): string[] {
    if (plan === "pro") return models
    return models
  }

  export async function getAvailableModels(): Promise<string[]> {
    const plan = await getUserPlan()
    return plan.availableModels
  }

  export async function checkStartupAllowed(): Promise<{ allowed: boolean; reason?: string }> {
    if (!Backend.isBackendEnabled()) {
      return { allowed: true }
    }

    try {
      const result = await Backend.UsageBackend.checkStartup()
      return { allowed: result.allowed, reason: result.reason }
    } catch (error) {
      log.warn("startup check failed", { error })
      return { allowed: true }
    }
  }

  export async function isContextExhausted(modelId: string): Promise<boolean> {
    if (!Backend.isBackendEnabled()) return false

    try {
      return await Backend.ModelsBackend.isContextExhausted(modelId)
    } catch {
      return false
    }
  }

  export async function getContextStatus(modelId: string): Promise<{
    remainingPct: number
    exhausted: boolean
    message: string
  }> {
    if (!Backend.isBackendEnabled()) {
      return {
        remainingPct: 100,
        exhausted: false,
        message: "",
      }
    }

    try {
      const context = await Backend.ModelsBackend.getModelContext(modelId)
      return {
        remainingPct: context.remaining_pct,
        exhausted: context.exhausted,
        message: context.message,
      }
    } catch {
      return {
        remainingPct: 100,
        exhausted: false,
        message: "",
      }
    }
  }

  export function clearCache(): void {
    cachedPlan = null
    planCacheTime = 0
  }

  export function formatPlan(plan: UserPlan): string {
    return [
      `Plan: ${plan.plan.toUpperCase()}`,
      `Trial Days Remaining: ${plan.trialDaysRemaining}`,
      `Pro Access: ${plan.canAccessPro ? "Yes" : "No"}`,
    ].join("\n")
  }
}

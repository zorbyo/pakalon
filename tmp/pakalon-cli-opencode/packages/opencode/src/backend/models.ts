import { Log } from "../util/log"
import { getClient } from "./client"
import type {
  ModelsResponse,
  ModelInfo,
  ModelContextResponse,
} from "./types"

const log = Log.create({ service: "backend:models" })
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
const OPENROUTER_CACHE_TTL_MS = 24 * 60 * 60 * 1000

type OpenRouterModelRecord = {
  id?: string
  name?: string
  context_length?: number
  top_provider?: {
    context_length?: number
  }
  pricing?: {
    prompt?: string
    completion?: string
  }
  supported_parameters?: string[]
}

type OpenRouterSnapshot = {
  contextLength: number
  isFree: boolean
  name?: string
  pricing?: {
    prompt: string
    completion: string
  }
  supportedParameters?: string[]
}

let openRouterCacheAt = 0
let openRouterCache = new Map<string, OpenRouterSnapshot>()

function modelID(model: ModelInfo): string | undefined {
  return model.id ?? model.model_id ?? undefined
}

function parseOpenRouterPrice(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

function isOpenRouterFreePricing(pricing: OpenRouterModelRecord["pricing"], id: string): boolean {
  const prompt = parseOpenRouterPrice(pricing?.prompt)
  const completion = parseOpenRouterPrice(pricing?.completion)
  if (prompt !== undefined || completion !== undefined) {
    return (prompt ?? 0) === 0 && (completion ?? 0) === 0
  }
  return id.endsWith(":free")
}

function normalizeOpenRouterPricing(pricing: OpenRouterModelRecord["pricing"]) {
  if (!pricing) return undefined
  return {
    prompt: pricing.prompt ?? "0",
    completion: pricing.completion ?? "0",
  }
}

async function getOpenRouterSnapshot(force = false): Promise<Map<string, OpenRouterSnapshot>> {
  const now = Date.now()
  if (!force && openRouterCache.size > 0 && now - openRouterCacheAt < OPENROUTER_CACHE_TTL_MS) {
    return openRouterCache
  }

  try {
    const response = await fetch(OPENROUTER_MODELS_URL, {
      headers: {
        Accept: "application/json",
      },
    })

    if (!response.ok) {
      throw new Error(`OpenRouter responded with ${response.status}`)
    }

    const payload = (await response.json()) as { data?: OpenRouterModelRecord[] }
    const next = new Map<string, OpenRouterSnapshot>()

    for (const model of payload.data ?? []) {
      const id = model.id?.trim()
      if (!id) continue
      next.set(id, {
        contextLength: model.context_length ?? model.top_provider?.context_length ?? 0,
        isFree: isOpenRouterFreePricing(model.pricing, id),
        name: model.name,
        pricing: normalizeOpenRouterPricing(model.pricing),
        supportedParameters: model.supported_parameters,
      })
    }

    if (next.size > 0) {
      openRouterCache = next
      openRouterCacheAt = now
    }
  } catch (error) {
    log.warn("failed to refresh openrouter model snapshot", {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return openRouterCache
}

function reconcileModels(response: ModelsResponse, liveModels: Map<string, OpenRouterSnapshot>): ModelsResponse {
  if (liveModels.size === 0) return response

  const merged: ModelInfo[] = []
  const seen = new Set<string>()

  for (const model of response.models) {
    const id = modelID(model)
    if (!id) {
      merged.push(model)
      continue
    }

    seen.add(id)
    const live = liveModels.get(id)
    if (!live) {
      if (!id.includes("/")) {
        merged.push(model)
      }
      continue
    }

    merged.push({
      ...model,
      id: model.id ?? id,
      model_id: model.model_id ?? id,
      name: model.name || live.name || id,
      context_length: live.contextLength || model.context_length || model.top_provider?.context_length || 0,
      is_free: live.isFree,
      tier: live.isFree ? "free" : "paid",
      pricing_tier: live.isFree ? "free" : "pro",
      pricing: live.pricing ?? model.pricing,
      supported_parameters: live.supportedParameters,
    })
  }

  for (const [id, live] of liveModels) {
    if (seen.has(id)) continue
    merged.push({
      id,
      model_id: id,
      name: live.name ?? id,
      context_length: live.contextLength,
      is_free: live.isFree,
      tier: live.isFree ? "free" : "paid",
      pricing_tier: live.isFree ? "free" : "pro",
      pricing: live.pricing,
      supported_parameters: live.supportedParameters,
    })
  }

  return {
    ...response,
    models: merged,
    count: merged.length,
  }
}

export namespace ModelsBackend {
  function isZeroPrice(value: unknown): boolean {
    if (value == null) return false
    if (typeof value === "number") return value === 0
    if (typeof value !== "string") return false
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) && parsed === 0
  }

  export function isFreeModel(model: ModelInfo): boolean {
    const hasPricing =
      model.pricing !== undefined && ("prompt" in model.pricing || "completion" in model.pricing)
    if (hasPricing) {
      return isZeroPrice(model.pricing?.prompt) && isZeroPrice(model.pricing?.completion)
    }

    if (model.is_free === true) return true

    const tier = (model.tier ?? model.pricing_tier ?? "").toLowerCase()
    if (tier === "free") return true

    const modelID = (model.id ?? model.model_id ?? "").toLowerCase()
    if (modelID.endsWith(":free")) return true
    return false
  }

  export async function listModels(includeAll = false): Promise<ModelsResponse> {
    const client = getClient()
    const params = includeAll ? "?include_all=true" : ""
    log.info("fetching models", { includeAll })
    const response = await client.get<ModelsResponse>(`/models${params}`)
    const liveModels = await getOpenRouterSnapshot()
    const reconciled = reconcileModels(response, liveModels)
    log.info("models fetched", { count: reconciled.count ?? reconciled.models.length, plan: reconciled.plan })
    return reconciled
  }

  export async function getAutoModel(): Promise<ModelInfo> {
    const client = getClient()
    log.info("fetching auto model")
    const response = await client.get<ModelInfo>("/models/auto")
    log.info("auto model fetched", { model: response.id ?? response.model_id ?? response.name })
    return response
  }

  export async function getModelContext(modelId: string): Promise<ModelContextResponse> {
    const client = getClient()
    const encodedModelId = encodeURIComponent(modelId)
    log.info("fetching model context", { modelId })
    
    try {
      const response = await client.get<ModelContextResponse>(
        `/models/${encodedModelId}/context`,
      )
      return response
    } catch (error: any) {
      if (error.status === 429) {
        return {
          model_id: modelId,
          remaining_pct: 0,
          exhausted: true,
          message: error.message || "Context window exhausted",
        }
      }
      throw error
    }
  }

  export async function isContextExhausted(modelId: string): Promise<boolean> {
    const context = await getModelContext(modelId)
    return context.exhausted
  }

  export async function refreshModels(): Promise<void> {
    const client = getClient()
    log.info("triggering model refresh")
    openRouterCacheAt = 0
    openRouterCache = new Map()
    await client.post("/models/refresh")
    log.info("model refresh triggered")
  }

  export function filterByPlan(models: ModelInfo[], plan: "free" | "pro"): ModelInfo[] {
    if (plan === "pro") return models

    const filtered = models.filter((m) => isFreeModel(m))
    if (filtered.length > 0) return filtered

    log.warn("free-plan filtering found no tagged models; returning backend list as-is", { count: models.length })
    return models
  }

  export function getModelWithRemainingPct(models: ModelInfo[]): Array<ModelInfo & { remaining_pct: number }> {
    return models.map((m) => ({
      ...m,
      remaining_pct: m.remaining_pct ?? 100,
    }))
  }
}

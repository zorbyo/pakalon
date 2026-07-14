import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { Global } from "../global"
import path from "path"

const log = Log.create({ service: "provider:openrouter" })

export interface OpenRouterModel {
  id: string
  name: string
  description: string
  contextLength: number
  pricing: {
    prompt: string
    completion: string
  }
  topProvider: {
    contextLength: number
    maxCompletionTokens: number
  }
  architecture: {
    modality: string
    tokenizer: string
    instructType: string | null
  }
  isFree: boolean
  perRequestLimits: Record<string, unknown> | null
  isNew?: boolean
  releasedAt?: string
}

export interface OpenRouterResponse {
  data: Array<{
    id: string
    name: string
    description: string
    context_length: number
    pricing: { prompt: string; completion: string }
    top_provider: { context_length: number; max_completion_tokens: number }
    architecture: { modality: string; tokenizer: string; instruct_type: string | null }
    per_request_limits: Record<string, unknown> | null
    created_at?: string
  }>
}

export interface ModelCategory {
  name: string
  models: OpenRouterModel[]
}

export interface ModelChange {
  type: "delisted" | "tier_change"
  modelID: string
  oldTier?: string
  newTier?: string
}

const MODELS_CACHE_FILE = path.join(Global.Path.cache, "openrouter-models.json")
const CACHE_TTL = 24 * 60 * 60 * 1000
const DAILY_CHECK_INTERVAL = 24 * 60 * 60 * 1000
const PREFERRED_DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free"

// Auto-refresh interval (daily)
const AUTO_REFRESH_INTERVAL = 24 * 60 * 60 * 1000
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null

function parsePrice(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

function isFreeByPricing(raw: OpenRouterResponse["data"][number]): boolean {
  const prompt = parsePrice(raw.pricing?.prompt)
  const completion = parsePrice(raw.pricing?.completion)
  if (prompt !== undefined || completion !== undefined) {
    return (prompt ?? 0) === 0 && (completion ?? 0) === 0
  }
  return raw.id.endsWith(":free")
}

export namespace OpenRouter {
  const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.PAKALON_OPENROUTER_KEY ?? ""
  let modelsCache: OpenRouterModel[] | undefined
  let cacheTime = 0
  let lastDailyCheck = 0
  let lastModelChanges: ModelChange[] = []

  export function hasKey(): boolean {
    return apiKey.length > 0
  }

  export function getKey(): string {
    return apiKey
  }

  export async function fetchModels(): Promise<OpenRouterModel[]> {
    const now = Date.now()
    if (modelsCache && now - cacheTime < CACHE_TTL) {
      return modelsCache
    }

    log.info("fetching models from OpenRouter")

    try {
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      })
      const data: OpenRouterResponse = await res.json()
      const newModels = data.data.map(transformModel)

      if (now - lastDailyCheck >= DAILY_CHECK_INTERVAL) {
        const changes = detectModelChanges(modelsCache ?? [], newModels)
        if (changes.length > 0) {
          lastModelChanges = changes
          log.info("detected model changes", { changes: changes.length })
        }
        lastDailyCheck = now
      }

      modelsCache = newModels
      cacheTime = now
      await saveCache(modelsCache)
      log.info("fetched models", { count: modelsCache.length })
      return modelsCache
    } catch {
      log.warn("failed to fetch models, using cache")
      return loadCache()
    }
  }

  export async function getFreeModels(): Promise<OpenRouterModel[]> {
    const models = await fetchModels()
    return models.filter((m) => m.isFree)
  }

  export async function getProModels(): Promise<OpenRouterModel[]> {
    const models = await fetchModels()
    return models.filter((m) => !m.isFree)
  }

  export async function getModelsForPlan(plan: "free" | "pro"): Promise<OpenRouterModel[]> {
    if (plan === "free") return getFreeModels()
    return fetchModels()
  }

  export async function getAutoModel(): Promise<OpenRouterModel | undefined> {
    const models = await fetchModels()
    if (models.length === 0) return undefined

    const preferred = models.find((model) => model.id === PREFERRED_DEFAULT_MODEL)
    if (preferred) return preferred

    const sorted = [...models].sort((a, b) => {
      const aCtx = a.contextLength
      const bCtx = b.contextLength
      if (aCtx !== bCtx) return bCtx - aCtx
      const aCost = parseFloat(a.pricing.prompt)
      const bCost = parseFloat(b.pricing.prompt)
      return aCost - bCost
    })

    return sorted[0]
  }

  export async function searchModels(query: string): Promise<OpenRouterModel[]> {
    const models = await fetchModels()
    const q = query.toLowerCase()
    return models.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q),
    )
  }

  export async function refreshModels(): Promise<OpenRouterModel[]> {
    modelsCache = undefined
    cacheTime = 0
    return fetchModels()
  }

  export function getModelChanges(): ModelChange[] {
    return lastModelChanges
  }

  function detectModelChanges(previousModels: OpenRouterModel[], newModels: OpenRouterModel[]): ModelChange[] {
    const changes: ModelChange[] = []
    const newModelMap = new Map(newModels.map((m) => [m.id, m]))

    for (const prev of previousModels) {
      const updated = newModelMap.get(prev.id)
      if (!updated) {
        changes.push({ type: "delisted", modelID: prev.id, oldTier: prev.isFree ? "free" : "paid" })
      } else if (prev.isFree && !updated.isFree) {
        changes.push({ type: "tier_change", modelID: prev.id, oldTier: "free", newTier: "paid" })
      }
    }

    return changes
  }

  export async function getNewModels(sinceDays: number = 7): Promise<OpenRouterModel[]> {
    const models = await fetchModels()
    const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000

    return models.filter((m) => {
      if (m.releasedAt) {
        const released = new Date(m.releasedAt).getTime()
        return released > cutoff
      }
      return false
    })
  }

  export function categorizeModels(models: OpenRouterModel[]): ModelCategory[] {
    const categories: Record<string, OpenRouterModel[]> = {
      "Free Models": [],
      "Pro Models": [],
      "New Models": [],
      "High Context (100K+)": [],
      "Code Specialists": [],
      "Vision Models": [],
    }

    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

    for (const model of models) {
      if (model.isFree) {
        categories["Free Models"]!.push(model)
      } else {
        categories["Pro Models"]!.push(model)
      }

      if (model.releasedAt && new Date(model.releasedAt).getTime() > oneWeekAgo) {
        categories["New Models"]!.push(model)
      }

      if (model.contextLength >= 100000) {
        categories["High Context (100K+)"]!.push(model)
      }

      if (
        model.name.toLowerCase().includes("code") ||
        model.id.toLowerCase().includes("code") ||
        model.description.toLowerCase().includes("code")
      ) {
        categories["Code Specialists"]!.push(model)
      }

      if (model.architecture.modality.includes("vision") || model.architecture.modality.includes("image")) {
        categories["Vision Models"]!.push(model)
      }
    }

    return Object.entries(categories)
      .filter(([, models]) => models.length > 0)
      .map(([name, models]) => ({ name, models }))
  }

  export function startAutoRefresh(onRefresh?: (models: OpenRouterModel[]) => void): void {
    if (autoRefreshTimer) {
      log.warn("auto-refresh already running")
      return
    }

    log.info("starting auto-refresh", { interval: AUTO_REFRESH_INTERVAL })

    autoRefreshTimer = setInterval(async () => {
      try {
        const models = await refreshModels()
        log.info("auto-refresh completed", { count: models.length })
        onRefresh?.(models)
      } catch (err) {
        log.error("auto-refresh failed", { error: err })
      }
    }, AUTO_REFRESH_INTERVAL)
  }

  export function stopAutoRefresh(): void {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer)
      autoRefreshTimer = null
      log.info("stopped auto-refresh")
    }
  }

  export function sortByNewest(models: OpenRouterModel[]): OpenRouterModel[] {
    return [...models].sort((a, b) => {
      if (a.releasedAt && b.releasedAt) {
        return new Date(b.releasedAt).getTime() - new Date(a.releasedAt).getTime()
      }
      if (a.releasedAt) return -1
      if (b.releasedAt) return 1
      return 0
    })
  }

  export function sortByContext(models: OpenRouterModel[]): OpenRouterModel[] {
    return [...models].sort((a, b) => b.contextLength - a.contextLength)
  }

  export function sortByPrice(models: OpenRouterModel[]): OpenRouterModel[] {
    return [...models].sort((a, b) => {
      const aCost = parseFloat(a.pricing.prompt) + parseFloat(a.pricing.completion)
      const bCost = parseFloat(b.pricing.prompt) + parseFloat(b.pricing.completion)
      return aCost - bCost
    })
  }

  function transformModel(raw: OpenRouterResponse["data"][number]): OpenRouterModel {
    return {
      id: raw.id,
      name: raw.name,
      description: raw.description,
      contextLength: raw.context_length,
      pricing: {
        prompt: raw.pricing.prompt,
        completion: raw.pricing.completion,
      },
      topProvider: {
        contextLength: raw.top_provider.context_length,
        maxCompletionTokens: raw.top_provider.max_completion_tokens,
      },
      architecture: {
        modality: raw.architecture.modality,
        tokenizer: raw.architecture.tokenizer,
        instructType: raw.architecture.instruct_type,
      },
      isFree: isFreeByPricing(raw),
      perRequestLimits: raw.per_request_limits,
      releasedAt: raw.created_at,
      isNew: raw.created_at
        ? Date.now() - new Date(raw.created_at).getTime() < 7 * 24 * 60 * 60 * 1000
        : false,
    }
  }

  async function saveCache(models: OpenRouterModel[]): Promise<void> {
    try {
      await Filesystem.writeJson(MODELS_CACHE_FILE, { models, timestamp: Date.now(), lastDailyCheck })
    } catch {
      log.warn("failed to save models cache")
    }
  }

  async function loadCache(): Promise<OpenRouterModel[]> {
    try {
      const data = await Filesystem.readJson<{ models: OpenRouterModel[]; timestamp: number; lastDailyCheck?: number }>(
        MODELS_CACHE_FILE,
      )
      if (Date.now() - data.timestamp < CACHE_TTL) {
        modelsCache = data.models
        cacheTime = data.timestamp
        if (data.lastDailyCheck) lastDailyCheck = data.lastDailyCheck
        return data.models
      }
    } catch {}
    return []
  }

  export function formatModel(model: OpenRouterModel): string {
    const free = model.isFree ? " [FREE]" : ""
    const ctx = model.contextLength >= 1000
      ? `${(model.contextLength / 1000).toFixed(0)}K`
      : `${model.contextLength}`
    const newTag = model.isNew ? " [NEW]" : ""
    return `${model.name}${free}${newTag} (${ctx} ctx)`
  }

  export function categorize(models: OpenRouterModel[]): { free: OpenRouterModel[]; pro: OpenRouterModel[] } {
    const free: OpenRouterModel[] = []
    const pro: OpenRouterModel[] = []
    for (const m of models) {
      if (m.isFree) free.push(m)
      else pro.push(m)
    }
    return { free, pro }
  }
}

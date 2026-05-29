/**
 * Model slice — manages currently selected AI model.
 * T2-10: Auto-refresh available models from backend on mount + every 5 minutes.
 * TEMP-12: Daily OpenRouter sync for delisted/tier-change detection.
 */
import type { StateCreator } from "zustand";
import { AxiosError } from "axios";

import { createApiClient, getApiClient } from "@/api/client.js";
import {
  getSupportedEffortProvider,
  type ReasoningEffortModelLike,
} from "@/utils/model-effort.js";
import { isSelfHosted } from "@/config/mode.js";
import { discoverAllLocalModels, pickBestLocalModel } from "@/ai/local/discovery.js";
import { loadLocalModelRegistry, loadLocalSetting, saveLocalSetting } from "@/db/local.js";

export interface ModelInfo {
  id: string;
  name: string;
  contextLength: number;
  tier: "free" | "paid";
  provider?: string;
  supportedParameters?: string[];
  reasoning?: boolean;
  supportsReasoning?: boolean;
}

export function modelSupportsReasoningEffort(
  model?: ReasoningEffortModelLike | null,
): boolean {
  return getSupportedEffortProvider(model) !== null;
}

interface ApiModelRecord {
  id?: string;
  model_id?: string;
  name: string;
  context_length?: number;
  context_window?: number;
  tier?: "free" | "paid" | string;
  pricing_tier?: "free" | "pro" | string;
  provider?: string;
  supported_parameters?: string[];
  supportedParameters?: string[];
  reasoning?: boolean;
  supports_reasoning?: boolean;
  supportsReasoning?: boolean;
}

function normalizeModelRecord(model: ApiModelRecord): ModelInfo {
  const tier = model.tier ?? (model.pricing_tier === "free" ? "free" : "paid");
  return {
    id: model.id ?? model.model_id ?? "",
    name: model.name,
    contextLength: model.context_length ?? model.context_window ?? 0,
    tier: tier === "free" ? "free" : "paid",
    provider: model.provider,
    supportedParameters:
      model.supportedParameters ?? model.supported_parameters,
    reasoning: model.reasoning,
    supportsReasoning: model.supportsReasoning ?? model.supports_reasoning,
  };
}

/** Context check result from backend */
export interface ContextCheckResult {
  model_id: string;
  remaining_pct: number;
  exhausted: boolean;
  message?: string;
}

export interface ModelState {
  selectedModel: string | null;
  availableModels: ModelInfo[];
  autoModel: ModelInfo | null;
  isLoadingModels: boolean;
  modelsError: string | null;
  lastModelsFetchAt: number | null;
  lastDailyCheckAt: number | null;
  // Actions
  setSelectedModel: (modelId: string) => void;
  setAvailableModels: (models: ModelInfo[]) => void;
  setAutoModel: (model: ModelInfo | null) => void;
  setLoadingModels: (loading: boolean) => void;
  setModelsError: (error: string | null) => void;
  setLastModelsFetchAt: (ts: number | null) => void;
  setLastDailyCheckAt: (ts: number | null) => void;
  // T2-10: Fetch and refresh models from backend
  refreshModels: (
    apiBaseUrl?: string,
    authToken?: string,
    force?: boolean,
  ) => Promise<void>;
  // T-005: Check context window status before starting AI
  checkContextStatus: (
    modelId: string,
    apiBaseUrl?: string,
    authToken?: string,
    sessionId?: string,
  ) => Promise<ContextCheckResult>;
}

// Auto-refresh interval: 5 minutes
const MODEL_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
// Daily check interval: 24 hours
const DAILY_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const createModelSlice: StateCreator<ModelState, [], [], ModelState> = (
  set,
  get,
) => ({
  selectedModel: null,
  availableModels: [],
  autoModel: null,
  isLoadingModels: false,
  modelsError: null,
  lastModelsFetchAt: null,
  lastDailyCheckAt: null,

  setSelectedModel: (modelId) => {
    if (isSelfHosted()) saveLocalSetting("selected_model", modelId);
    set({ selectedModel: modelId });
  },
  setAvailableModels: (models) => set({ availableModels: models }),
  setAutoModel: (model) => set({ autoModel: model }),
  setLoadingModels: (loading) => set({ isLoadingModels: loading }),
  setModelsError: (error) => set({ modelsError: error }),
  setLastModelsFetchAt: (ts) => set({ lastModelsFetchAt: ts }),
  setLastDailyCheckAt: (ts) => set({ lastDailyCheckAt: ts }),

  /**
   * T2-10: Fetch models from the Pakalon backend and update the store.
   * TEMP-12: Daily sync with OpenRouter for delisted/tier-change detection.
   * Full OpenRouter comparison runs only once per 24 hours.
   */
  refreshModels: async (
    apiBaseUrl?: string,
    authToken?: string,
    force = false,
  ) => {
    if (isSelfHosted()) {
      set({ isLoadingModels: true, modelsError: null });
      try {
        const discovered = await discoverAllLocalModels();
        const localModels = discovered.length > 0 ? discovered : loadLocalModelRegistry();
        const models: ModelInfo[] = localModels.map((model) => ({
          id: model.id,
          name: model.name,
          contextLength: model.contextWindow,
          tier: "free",
          provider: model.provider,
        }));
        const selectedSetting = loadLocalSetting<string>("selected_model");
        const currentSelection = get().selectedModel;
        const currentStillAvailable = currentSelection && models.some((model) => model.id === currentSelection);
        const selectedStillAvailable = selectedSetting && models.some((model) => model.id === selectedSetting);
        const best = pickBestLocalModel(localModels);
        set({
          availableModels: models,
          selectedModel: currentStillAvailable
            ? currentSelection
            : selectedStillAvailable
              ? selectedSetting
              : best?.id ?? null,
          autoModel: best
            ? {
                id: best.id,
                name: best.name,
                contextLength: best.contextWindow,
                tier: "free",
                provider: best.provider,
              }
            : null,
          lastModelsFetchAt: Date.now(),
          isLoadingModels: false,
          modelsError: null,
        });
      } catch (err) {
        set({
          isLoadingModels: false,
          modelsError: err instanceof Error ? err.message : "Unable to load local models.",
        });
      }
      return;
    }

    const now = Date.now();
    const last = get().lastModelsFetchAt;
    const lastDaily = get().lastDailyCheckAt;
    const shouldDoDailyCheck =
      force || lastDaily === null || now - lastDaily >= DAILY_CHECK_INTERVAL_MS;

    if (!force && last !== null && now - last < MODEL_REFRESH_INTERVAL_MS) {
      return;
    }

    const client = apiBaseUrl ? createApiClient(apiBaseUrl) : getApiClient();
    set({ isLoadingModels: true, modelsError: null });

    let openRouterModels: Map<
      string,
      {
        tier: "free" | "paid";
        contextLength: number;
        supportedParameters?: string[];
      }
    > = new Map();

    if (shouldDoDailyCheck) {
      try {
        const axiosMod = await import("axios");
        const res = await axiosMod.default.get<{
          data?: Array<{
            id: string;
            context_length?: number;
            supported_parameters?: string[];
          }>;
        }>("https://openrouter.ai/api/v1/models", {
          headers: { Accept: "application/json" },
          timeout: 20_000,
        });
        const rawModels = res.data?.data ?? [];
        for (const m of rawModels) {
          if (!m.id) continue;
          openRouterModels.set(m.id, {
            tier: m.id.includes(":free") ? "free" : "paid",
            contextLength: m.context_length ?? 0,
            supportedParameters: m.supported_parameters,
          });
        }
      } catch {
        // OpenRouter direct fetch failed — will rely on backend data only
      }
    }

    try {
      const { data } = await client.get<{ models: ApiModelRecord[] }>(
        "/models?include_all=true",
        {
          headers: authToken
            ? { Authorization: `Bearer ${authToken}` }
            : undefined,
        },
      );

      const models: ModelInfo[] = (data.models ?? [])
        .map(normalizeModelRecord)
        .filter((model) => Boolean(model.id));

      // Sync tier from OpenRouter live data — only during daily check
      if (openRouterModels.size > 0) {
        for (const model of models) {
          const liveData = openRouterModels.get(model.id);
          if (liveData) {
            model.tier = liveData.tier;
            if (liveData.contextLength > 0) {
              model.contextLength = liveData.contextLength;
            }
            if (liveData.supportedParameters) {
              model.supportedParameters = liveData.supportedParameters;
            }
          }
        }

        // Add any models from OpenRouter that aren't in the backend response
        const backendIds = new Set(models.map((m) => m.id));
        for (const [id, liveData] of openRouterModels) {
          if (!backendIds.has(id)) {
            models.push({
              id,
              name: id.split("/").pop() ?? id,
              contextLength: liveData.contextLength,
              tier: liveData.tier,
              supportedParameters: liveData.supportedParameters,
            });
          }
        }

        // Remove models that no longer exist on OpenRouter (delisted/removed)
        const liveIds = new Set(openRouterModels.keys());
        const before = models.length;
        const filtered = models.filter(
          (m) => liveIds.has(m.id) || !m.id.includes("/"),
        );
        if (filtered.length < before) {
          models.length = 0;
          models.push(...filtered);
        }
      }

      const update: Partial<ModelState> = {
        availableModels: models,
        lastModelsFetchAt: Date.now(),
        isLoadingModels: false,
        modelsError: null,
      };

      if (shouldDoDailyCheck && openRouterModels.size > 0) {
        update.lastDailyCheckAt = Date.now();
      }

      set(update);

      if (!get().selectedModel && models.length > 0) {
        const firstFree =
          models.find((model) => model.tier === "free") ?? models[0];
        const nextModel = firstFree;
        if (nextModel) {
          set({ selectedModel: nextModel.id });
        }
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to load models.";
      set({ isLoadingModels: false, modelsError: message });
    }
  },

  /**
   * T-005: Check context window status for a specific model.
   * Returns { exhausted, remaining_pct, message } - throws on 429 (exhausted).
   * The backend returns 429 when context is exhausted.
   */
  checkContextStatus: async (
    modelId: string,
    apiBaseUrl?: string,
    authToken?: string,
    sessionId?: string,
  ) => {
    if (isSelfHosted()) {
      return {
        model_id: modelId,
        exhausted: false,
        remaining_pct: 100,
      };
    }

    const client = apiBaseUrl ? createApiClient(apiBaseUrl) : getApiClient();
    const encodedModel = encodeURIComponent(modelId);
    const query = sessionId
      ? `?session_id=${encodeURIComponent(sessionId)}`
      : "";

    try {
      const { data } = await client.get<ContextCheckResult>(
        `/models/${encodedModel}/context${query}`,
        {
          headers: authToken
            ? { Authorization: `Bearer ${authToken}` }
            : undefined,
        },
      );
      return {
        model_id: data.model_id ?? modelId,
        exhausted: data.exhausted ?? false,
        remaining_pct: data.remaining_pct ?? 100,
        message: data.message,
      };
    } catch (err) {
      const axiosError = err as AxiosError<{ detail?: string }>;
      if (axiosError.response?.status === 429) {
        return {
          model_id: modelId,
          exhausted: true,
          remaining_pct: 0,
          message:
            axiosError.response.data?.detail ||
            `Context exhausted for ${modelId}. Use /model switch to continue.`,
        };
      }
      throw err;
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// T2-10: Background auto-refresh helper (call once on app mount)
// ─────────────────────────────────────────────────────────────────────────────

let _autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
let _dailyModelRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function msUntilNextIstMidnight(now = new Date()): number {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const utcMs = now.getTime();
  const istNow = new Date(utcMs + IST_OFFSET_MS);
  const nextIstMidnightUtcMs =
    Date.UTC(
      istNow.getUTCFullYear(),
      istNow.getUTCMonth(),
      istNow.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    ) - IST_OFFSET_MS;

  return Math.max(1_000, nextIstMidnightUtcMs - utcMs);
}

/**
 * Start a background interval that refreshes models every MODEL_REFRESH_INTERVAL_MS.
 * Call from App root or ChatScreen on mount. Safe to call multiple times (idempotent).
 *
 * @param getToken  Callback that returns the current auth token (may change over time)
 * @param getStore  Callback that returns the current refreshModels function
 */
export function startModelAutoRefresh(
  getToken: () => string | null,
  getStore: () => { refreshModels: ModelState["refreshModels"] },
  apiBaseUrl?: string,
): () => void {
  if (_autoRefreshTimer !== null) return () => stopModelAutoRefresh();

  // Immediate first fetch
  const { refreshModels } = getStore();
  refreshModels(apiBaseUrl, getToken() ?? undefined).catch(() => {});

  _autoRefreshTimer = setInterval(() => {
    const { refreshModels: refresh } = getStore();
    refresh(apiBaseUrl, getToken() ?? undefined).catch(() => {});
  }, MODEL_REFRESH_INTERVAL_MS);

  const scheduleDailyRefresh = () => {
    if (_dailyModelRefreshTimer !== null) clearTimeout(_dailyModelRefreshTimer);
    _dailyModelRefreshTimer = setTimeout(() => {
      const { refreshModels: refresh } = getStore();
      refresh(apiBaseUrl, getToken() ?? undefined, true).finally(() => {
        scheduleDailyRefresh();
      });
    }, msUntilNextIstMidnight());
  };
  scheduleDailyRefresh();

  return () => stopModelAutoRefresh();
}

export function stopModelAutoRefresh(): void {
  if (_autoRefreshTimer !== null) {
    clearInterval(_autoRefreshTimer);
    _autoRefreshTimer = null;
  }
  if (_dailyModelRefreshTimer !== null) {
    clearTimeout(_dailyModelRefreshTimer);
    _dailyModelRefreshTimer = null;
  }
}

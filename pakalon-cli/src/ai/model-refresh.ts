import axios from "axios";
import { useStore } from "@/store/index.js";
import { debugLog } from "@/utils/logger.js";
import { isSelfHosted } from "@/config/mode.js";
import type { ModelInfo } from "@/store/slices/model.slice.js";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

interface OpenRouterModelRecord {
  id: string;
  name?: string;
  context_length?: number;
  created?: number;
  supported_parameters?: string[];
}

function isFreeModel(id: string): boolean {
  return id.endsWith(":free");
}

function sortNewestFirst(
  a: { created?: number },
  b: { created?: number },
): number {
  return (b.created ?? 0) - (a.created ?? 0);
}

async function fetchOpenRouterModels(): Promise<ModelInfo[]> {
  const res = await axios.get<{ data?: OpenRouterModelRecord[] }>(
    OPENROUTER_MODELS_URL,
    {
      headers: { Accept: "application/json" },
      timeout: 20_000,
    },
  );

  const raw = res.data?.data ?? [];
  raw.sort(sortNewestFirst);
  const models: ModelInfo[] = raw
    .filter((m) => Boolean(m.id))
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id.split("/").pop() ?? m.id,
      contextLength: m.context_length ?? 0,
      tier: isFreeModel(m.id) ? "free" : "paid",
      supportedParameters: m.supported_parameters,
    }));

  return models;
}

async function runRefresh(): Promise<void> {
  if (isSelfHosted()) return;

  try {
    debugLog("[model-refresh] Starting daily model refresh from OpenRouter");
    const models = await fetchOpenRouterModels();
    const state = useStore.getState();
    const now = Date.now();

    state.setAvailableModels(models);
    state.setLastModelsFetchAt(now);

    if (!state.selectedModel && models.length > 0) {
      const firstFree = models.find((m) => m.tier === "free") ?? models[0];
      if (firstFree) {
        state.setSelectedModel(firstFree.id);
      }
    }

    debugLog(
      `[model-refresh] Refreshed ${models.length} models (${models.filter((m) => m.tier === "free").length} free, ${models.filter((m) => m.tier === "paid").length} pro)`,
    );
  } catch (err) {
    debugLog(`[model-refresh] Failed to refresh models: ${String(err)}`);
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startModelRefreshScheduler(): void {
  if (timer !== null || isSelfHosted()) return;

  const store = useStore.getState();
  const lastFetch = store.lastModelsFetchAt;

  if (lastFetch !== null && Date.now() - lastFetch < STALE_THRESHOLD_MS) {
    const remaining = STALE_THRESHOLD_MS - (Date.now() - lastFetch);
    timer = setInterval(runRefresh, DAILY_INTERVAL_MS);
    setTimeout(() => {
      runRefresh().finally(() => {
        if (timer !== null) clearInterval(timer);
        timer = setInterval(runRefresh, DAILY_INTERVAL_MS);
      });
    }, remaining);
    debugLog(
      `[model-refresh] Scheduler started — next refresh in ${Math.round(remaining / 60_000)}m`,
    );
    return;
  }

  runRefresh();
  timer = setInterval(runRefresh, DAILY_INTERVAL_MS);
  debugLog("[model-refresh] Scheduler started — initial fetch triggered");
}

export function stopModelRefreshScheduler(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
    debugLog("[model-refresh] Scheduler stopped");
  }
}

export async function refreshModelsNow(): Promise<ModelInfo[]> {
  const models = await fetchOpenRouterModels();
  const state = useStore.getState();
  state.setAvailableModels(models);
  state.setLastModelsFetchAt(Date.now());
  return models;
}

export interface ResolvedModelInfo {
  modelId: string | null;
  wasFallback: boolean;
}

export function isNonRoutableModelId(modelId?: string | null): boolean {
  if (!modelId) return false;
  return modelId.trim().toLowerCase() === "auto";
}

const FALLBACK_MODEL_IDS = [
  "openrouter/auto",
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemma-2-9b-it:free",
  "qwen/qwen2.5-7b-instruct:free",
  "mistralai/mistral-7b-instruct:free",
];

function pickPreferredAvailableModelId(availableModelIds: string[]): string | null {
  if (!availableModelIds.length) return null;
  const routable = availableModelIds.find((modelId) => !isNonRoutableModelId(modelId));
  return routable ?? availableModelIds[0] ?? null;
}

export function resolveUsableModelId(
  selectedModel: string | null,
  availableModelIds: string[],
  defaultModel?: string | null,
  fallbackModel?: string | null,
): ResolvedModelInfo {
  if (
    selectedModel &&
    availableModelIds.includes(selectedModel) &&
    !isNonRoutableModelId(selectedModel)
  ) {
    return { modelId: selectedModel, wasFallback: false };
  }

  const preferredAvailable = pickPreferredAvailableModelId(availableModelIds);
  if (preferredAvailable) {
    return { modelId: preferredAvailable, wasFallback: false };
  }

  if (defaultModel) return { modelId: defaultModel, wasFallback: true };
  if (fallbackModel) return { modelId: fallbackModel, wasFallback: true };

  for (const fallback of FALLBACK_MODEL_IDS) {
    return { modelId: fallback, wasFallback: true };
  }

  return { modelId: null, wasFallback: true };
}

export function findFallbackModelFor404(currentModelId: string, availableModelIds: string[]): string | null {
  if (availableModelIds.length === 0) {
    for (const fb of FALLBACK_MODEL_IDS) {
      if (fb !== currentModelId) return fb;
    }
    return null;
  }
  const other = availableModelIds.find(
    (id) => id !== currentModelId && !isNonRoutableModelId(id),
  );
  if (other) return other;
  for (const fb of FALLBACK_MODEL_IDS) {
    if (fb !== currentModelId) return fb;
  }
  return null;
}

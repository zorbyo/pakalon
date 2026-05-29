import type { ModelMessage as CoreMessage } from "ai";
import { loadModeConfig } from "@/config/mode.js";
import { discoverOllamaModels, generateOllamaCompletion, streamOllamaCompletion } from "@/ai/local/ollama.js";
import { discoverLMStudioModels, generateLMStudioCompletion, streamLMStudioCompletion } from "@/ai/local/lmstudio.js";
import type { LocalModel, LocalProviderConfig } from "@/ai/local/types.js";
import { loadLocalModelRegistry, saveLocalModelRegistry } from "@/db/local.js";

export function isLocalModelId(modelId?: string | null): boolean {
  return Boolean(modelId && /^(ollama|lmstudio):/.test(modelId));
}

export function parseLocalModelId(modelId: string): { provider: LocalModel["provider"]; name: string } {
  const [provider, ...rest] = modelId.split(":");
  if ((provider !== "ollama" && provider !== "lmstudio") || rest.length === 0) {
    throw new Error(`Invalid local model id: ${modelId}`);
  }
  return { provider, name: rest.join(":") };
}

export async function discoverAllLocalModels(config: LocalProviderConfig = loadModeConfig().localProviders): Promise<LocalModel[]> {
  const discoveries: Array<Promise<LocalModel[]>> = [];

  if (config.ollama?.enabled) {
    discoveries.push(discoverOllamaModels(config.ollama.baseUrl).catch(() => []));
  }

  if (config.lmstudio?.enabled) {
    discoveries.push(discoverLMStudioModels(config.lmstudio.baseUrl).catch(() => []));
  }

  const results = await Promise.all(discoveries);
  const models = results.flat();
  saveLocalModelRegistry(models);
  return models;
}

export function pickBestLocalModel(models: LocalModel[]): LocalModel | null {
  if (models.length === 0) return null;
  const preferredFamilies = ["qwen", "coder", "code", "deepseek", "llama", "mistral"];
  return [...models].sort((a, b) => {
    const aRank = preferredFamilies.findIndex((family) =>
      `${a.id} ${a.name} ${a.family ?? ""}`.toLowerCase().includes(family),
    );
    const bRank = preferredFamilies.findIndex((family) =>
      `${b.id} ${b.name} ${b.family ?? ""}`.toLowerCase().includes(family),
    );
    const normalizedARank = aRank === -1 ? 999 : aRank;
    const normalizedBRank = bRank === -1 ? 999 : bRank;
    if (normalizedARank !== normalizedBRank) return normalizedARank - normalizedBRank;
    return b.contextWindow - a.contextWindow;
  })[0] ?? null;
}

export async function resolveLocalModel(modelId?: string | null): Promise<LocalModel> {
  let models = loadLocalModelRegistry();
  if (models.length === 0) {
    models = await discoverAllLocalModels();
  }

  if (modelId && modelId !== "auto") {
    const parsed = isLocalModelId(modelId) ? parseLocalModelId(modelId) : null;
    const exact = models.find((model) =>
      model.id === modelId ||
      model.name === modelId ||
      (parsed && model.provider === parsed.provider && model.name === parsed.name),
    );
    if (exact) return exact;
  }

  const best = pickBestLocalModel(models);
  if (!best) {
    throw new Error(
      "No local models found. Start Ollama or LM Studio, then pull or load a model before using self-hosted mode.",
    );
  }
  return best;
}

export async function streamLocalCompletion(opts: {
  model: string;
  messages: CoreMessage[];
  system?: string;
  temperature?: number;
  maxTokens?: number;
  onChunk?: (chunk: string) => void;
  onFinish?: (fullText: string, usage: { promptTokens: number; completionTokens: number }) => void;
  onError?: (err: Error) => void;
}): Promise<void> {
  const localModel = await resolveLocalModel(opts.model);
  const completionOptions = { ...opts, model: localModel };

  if (localModel.provider === "ollama") {
    return streamOllamaCompletion(completionOptions);
  }

  return streamLMStudioCompletion(completionOptions);
}

export async function generateLocalCompletion(opts: {
  model: string;
  messages: CoreMessage[];
  system?: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
  const localModel = await resolveLocalModel(opts.model);
  const completionOptions = { ...opts, model: localModel };

  if (localModel.provider === "ollama") {
    return generateOllamaCompletion(completionOptions);
  }

  return generateLMStudioCompletion(completionOptions);
}


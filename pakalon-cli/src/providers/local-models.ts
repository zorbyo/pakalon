/**
 * Ollama/LM Studio Integration
 *
 * Provides connection to local LLM models via Ollama and LM Studio.
 * Supports both cloud and self-hosted modes.
 *
 * Features:
 * - Auto-detection of running Ollama/LM Studio instances
 * - Model listing and selection
 * - Streaming chat completions
 * - Health checks
 * - Fallback to cloud providers
 */

import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LocalProvider = "ollama" | "lmstudio";

export interface LocalModel {
  /** Model ID */
  id: string;
  /** Model name */
  name: string;
  /** Provider */
  provider: LocalProvider;
  /** Model size */
  size?: string;
  /** Context window */
  contextLength?: number;
  /** Whether model is currently loaded */
  loaded?: boolean;
}

export interface LocalProviderConfig {
  /** Provider type */
  provider: LocalProvider;
  /** Base URL */
  baseUrl: string;
  /** API key (if required) */
  apiKey?: string;
  /** Timeout in ms */
  timeout?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ChatCompletionResult {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// ---------------------------------------------------------------------------
// Default Configurations
// ---------------------------------------------------------------------------

const DEFAULT_CONFIGS: Record<LocalProvider, LocalProviderConfig> = {
  ollama: {
    provider: "ollama",
    baseUrl: "http://localhost:11434",
    timeout: 30000,
  },
  lmstudio: {
    provider: "lmstudio",
    baseUrl: "http://localhost:1234",
    timeout: 30000,
  },
};

// ---------------------------------------------------------------------------
// Provider Detection
// ---------------------------------------------------------------------------

/**
 * Detect if Ollama is running
 */
export async function detectOllama(baseUrl?: string): Promise<boolean> {
  const url = baseUrl || DEFAULT_CONFIGS.ollama.baseUrl;
  try {
    const response = await fetch(`${url}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Detect if LM Studio is running
 */
export async function detectLMStudio(baseUrl?: string): Promise<boolean> {
  const url = baseUrl || DEFAULT_CONFIGS.lmstudio.baseUrl;
  try {
    const response = await fetch(`${url}/v1/models`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Detect available local providers
 */
export async function detectLocalProviders(): Promise<LocalProvider[]> {
  const providers: LocalProvider[] = [];

  const [ollamaRunning, lmstudioRunning] = await Promise.all([
    detectOllama(),
    detectLMStudio(),
  ]);

  if (ollamaRunning) providers.push("ollama");
  if (lmstudioRunning) providers.push("lmstudio");

  logger.info(`[LocalModels] Detected providers: ${providers.join(", ") || "none"}`);
  return providers;
}

// ---------------------------------------------------------------------------
// Model Listing
// ---------------------------------------------------------------------------

/**
 * List models from Ollama
 */
export async function listOllamaModels(baseUrl?: string): Promise<LocalModel[]> {
  const url = baseUrl || DEFAULT_CONFIGS.ollama.baseUrl;

  try {
    const response = await fetch(`${url}/api/tags`);
    if (!response.ok) return [];

    const data = await response.json();
    return (data.models || []).map((model: any) => ({
      id: model.name,
      name: model.name,
      provider: "ollama" as LocalProvider,
      size: model.size ? `${(model.size / 1e9).toFixed(1)}GB` : undefined,
      contextLength: model.details?.parameter_size ? parseInt(model.details.parameter_size) : undefined,
    }));
  } catch (error) {
    logger.warn(`[LocalModels] Failed to list Ollama models: ${error}`);
    return [];
  }
}

/**
 * List models from LM Studio
 */
export async function listLMStudioModels(baseUrl?: string): Promise<LocalModel[]> {
  const url = baseUrl || DEFAULT_CONFIGS.lmstudio.baseUrl;

  try {
    const response = await fetch(`${url}/v1/models`);
    if (!response.ok) return [];

    const data = await response.json();
    return (data.data || []).map((model: any) => ({
      id: model.id,
      name: model.id,
      provider: "lmstudio" as LocalProvider,
    }));
  } catch (error) {
    logger.warn(`[LocalModels] Failed to list LM Studio models: ${error}`);
    return [];
  }
}

/**
 * List all available local models
 */
export async function listAllLocalModels(): Promise<LocalModel[]> {
  const providers = await detectLocalProviders();
  const models: LocalModel[] = [];

  for (const provider of providers) {
    if (provider === "ollama") {
      models.push(...await listOllamaModels());
    } else if (provider === "lmstudio") {
      models.push(...await listLMStudioModels());
    }
  }

  return models;
}

// ---------------------------------------------------------------------------
// Chat Completions
// ---------------------------------------------------------------------------

/**
 * Create chat completion with Ollama
 */
async function ollamaChatCompletion(
  config: LocalProviderConfig,
  options: ChatCompletionOptions
): Promise<ChatCompletionResult> {
  const response = await fetch(`${config.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      stream: false,
      options: {
        temperature: options.temperature,
        num_predict: options.maxTokens,
      },
    }),
    signal: AbortSignal.timeout(config.timeout || 30000),
  });

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status}`);
  }

  const data = await response.json();
  return {
    content: data.message?.content || "",
    model: options.model,
    usage: data.eval_count ? {
      promptTokens: data.prompt_eval_count || 0,
      completionTokens: data.eval_count,
      totalTokens: (data.prompt_eval_count || 0) + data.eval_count,
    } : undefined,
  };
}

/**
 * Create chat completion with LM Studio
 */
async function lmstudioChatCompletion(
  config: LocalProviderConfig,
  options: ChatCompletionOptions
): Promise<ChatCompletionResult> {
  const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
    }),
    signal: AbortSignal.timeout(config.timeout || 30000),
  });

  if (!response.ok) {
    throw new Error(`LM Studio API error: ${response.status}`);
  }

  const data = await response.json();
  return {
    content: data.choices?.[0]?.message?.content || "",
    model: options.model,
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    } : undefined,
  };
}

/**
 * Create chat completion with local provider
 */
export async function localChatCompletion(
  provider: LocalProvider,
  options: ChatCompletionOptions,
  config?: Partial<LocalProviderConfig>
): Promise<ChatCompletionResult> {
  const fullConfig: LocalProviderConfig = {
    ...DEFAULT_CONFIGS[provider],
    ...config,
  };

  logger.info(`[LocalModels] Chat completion with ${provider}/${options.model}`);

  if (provider === "ollama") {
    return ollamaChatCompletion(fullConfig, options);
  } else if (provider === "lmstudio") {
    return lmstudioChatCompletion(fullConfig, options);
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

// ---------------------------------------------------------------------------
// Health Checks
// ---------------------------------------------------------------------------

/**
 * Check provider health
 */
export async function checkProviderHealth(
  provider: LocalProvider,
  baseUrl?: string
): Promise<{ healthy: boolean; latency: number }> {
  const startTime = Date.now();
  const config = DEFAULT_CONFIGS[provider];
  const url = baseUrl || config.baseUrl;

  try {
    let healthy = false;

    if (provider === "ollama") {
      healthy = await detectOllama(url);
    } else if (provider === "lmstudio") {
      healthy = await detectLMStudio(url);
    }

    return {
      healthy,
      latency: Date.now() - startTime,
    };
  } catch {
    return {
      healthy: false,
      latency: Date.now() - startTime,
    };
  }
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Get default provider config
 */
export function getDefaultConfig(provider: LocalProvider): LocalProviderConfig {
  return { ...DEFAULT_CONFIGS[provider] };
}

/**
 * Check if local mode is available
 */
export async function isLocalModeAvailable(): Promise<boolean> {
  const providers = await detectLocalProviders();
  return providers.length > 0;
}

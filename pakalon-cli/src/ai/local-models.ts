/**
 * Local Models Integration
 *
 * Full integration with Ollama and LM Studio for local model support.
 * Supports:
 * - Ollama API integration
 * - LM Studio API integration
 * - Model discovery
 * - Model loading/unloading
 * - Health checks
 */

import logger from '@/utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LocalModelProvider = 'ollama' | 'lmstudio';

export interface LocalModelConfig {
  /** Provider type */
  provider: LocalModelProvider;
  /** API base URL */
  baseUrl: string;
  /** API key (optional) */
  apiKey?: string;
  /** Timeout (ms) */
  timeout?: number;
}

export interface LocalModel {
  /** Model ID */
  id: string;
  /** Model name */
  name: string;
  /** Model size */
  size?: number;
  /** Modified time */
  modified?: Date;
  /** Provider */
  provider: LocalModelProvider;
  /** Whether model is loaded */
  loaded?: boolean;
}

export interface LocalModelStatus {
  /** Provider status */
  status: 'connected' | 'disconnected' | 'error';
  /** Available models */
  models: LocalModel[];
  /** Currently loaded model */
  loadedModel?: string;
  /** Error message */
  error?: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let ollamaConfig: LocalModelConfig = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434',
  timeout: 30_000,
};

let lmstudioConfig: LocalModelConfig = {
  provider: 'lmstudio',
  baseUrl: 'http://localhost:1234',
  timeout: 30_000,
};

// ---------------------------------------------------------------------------
// Ollama Integration
// ---------------------------------------------------------------------------

/**
 * Configure Ollama
 */
export function configureOllama(config: Partial<LocalModelConfig>): void {
  ollamaConfig = { ...ollamaConfig, ...config };
  logger.info(`[local-models] Configured Ollama: ${ollamaConfig.baseUrl}`);
}

/**
 * Check Ollama status
 */
export async function checkOllamaStatus(): Promise<LocalModelStatus> {
  try {
    const response = await fetch(`${ollamaConfig.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(ollamaConfig.timeout ?? 30_000),
    });

    if (!response.ok) {
      return {
        status: 'error',
        models: [],
        error: `HTTP ${response.status}`,
      };
    }

    const data = await response.json() as { models?: Array<{ name: string; size: number; modified_at: string }> };
    const models: LocalModel[] = (data.models ?? []).map((m) => ({
      id: m.name,
      name: m.name,
      size: m.size,
      modified: new Date(m.modified_at),
      provider: 'ollama' as const,
    }));

    return {
      status: 'connected',
      models,
    };
  } catch (error) {
    return {
      status: 'disconnected',
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * List Ollama models
 */
export async function listOllamaModels(): Promise<LocalModel[]> {
  const status = await checkOllamaStatus();
  return status.models;
}

/**
 * Pull an Ollama model
 */
export async function pullOllamaModel(
  modelName: string,
  onProgress?: (progress: { status: string; completed?: number; total?: number }) => void,
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`${ollamaConfig.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
      signal: AbortSignal.timeout(300_000), // 5 minutes for pull
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    // Stream response for progress
    const reader = response.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        try {
          const progress = JSON.parse(chunk) as { status: string; completed?: number; total?: number };
          onProgress?.(progress);
        } catch {
          // Ignore parse errors
        }
      }
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Delete an Ollama model
 */
export async function deleteOllamaModel(modelName: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`${ollamaConfig.baseUrl}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
      signal: AbortSignal.timeout(ollamaConfig.timeout ?? 30_000),
    });

    return { success: response.ok };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Generate completion with Ollama
 */
export async function ollamaGenerate(
  model: string,
  prompt: string,
  options?: {
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
  },
): Promise<{ success: boolean; text?: string; error?: string }> {
  try {
    const response = await fetch(`${ollamaConfig.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        options: {
          temperature: options?.temperature,
          num_predict: options?.maxTokens,
        },
        stream: options?.stream ?? false,
      }),
      signal: AbortSignal.timeout(ollamaConfig.timeout ?? 30_000),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json() as { response?: string };
    return { success: true, text: data.response };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// LM Studio Integration
// ---------------------------------------------------------------------------

/**
 * Configure LM Studio
 */
export function configureLMStudio(config: Partial<LocalModelConfig>): void {
  lmstudioConfig = { ...lmstudioConfig, ...config };
  logger.info(`[local-models] Configured LM Studio: ${lmstudioConfig.baseUrl}`);
}

/**
 * Check LM Studio status
 */
export async function checkLMStudioStatus(): Promise<LocalModelStatus> {
  try {
    const response = await fetch(`${lmstudioConfig.baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(lmstudioConfig.timeout ?? 30_000),
    });

    if (!response.ok) {
      return {
        status: 'error',
        models: [],
        error: `HTTP ${response.status}`,
      };
    }

    const data = await response.json() as { data?: Array<{ id: string; object: string }> };
    const models: LocalModel[] = (data.data ?? []).map((m) => ({
      id: m.id,
      name: m.id,
      provider: 'lmstudio' as const,
    }));

    return {
      status: 'connected',
      models,
    };
  } catch (error) {
    return {
      status: 'disconnected',
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * List LM Studio models
 */
export async function listLMStudioModels(): Promise<LocalModel[]> {
  const status = await checkLMStudioStatus();
  return status.models;
}

/**
 * Generate completion with LM Studio
 */
export async function lmstudioGenerate(
  model: string,
  messages: Array<{ role: string; content: string }>,
  options?: {
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
  },
): Promise<{ success: boolean; text?: string; error?: string }> {
  try {
    const response = await fetch(`${lmstudioConfig.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        temperature: options?.temperature,
        max_tokens: options?.maxTokens,
        stream: options?.stream ?? false,
      }),
      signal: AbortSignal.timeout(lmstudioConfig.timeout ?? 30_000),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return { success: true, text: data.choices?.[0]?.message?.content };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Unified API
// ---------------------------------------------------------------------------

/**
 * Check all local model providers
 */
export async function checkAllLocalProviders(): Promise<Record<LocalModelProvider, LocalModelStatus>> {
  const [ollamaStatus, lmstudioStatus] = await Promise.all([
    checkOllamaStatus(),
    checkLMStudioStatus(),
  ]);

  return {
    ollama: ollamaStatus,
    lmstudio: lmstudioStatus,
  };
}

/**
 * Get all available local models
 */
export async function getAllLocalModels(): Promise<LocalModel[]> {
  const [ollamaModels, lmstudioModels] = await Promise.all([
    listOllamaModels(),
    listLMStudioModels(),
  ]);

  return [...ollamaModels, ...lmstudioModels];
}

/**
 * Generate with the best available local model
 */
export async function localGenerate(
  prompt: string,
  options?: {
    provider?: LocalModelProvider;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  },
): Promise<{ success: boolean; text?: string; provider?: LocalModelProvider; error?: string }> {
  // Try specified provider first
  if (options?.provider === 'ollama') {
    const result = await ollamaGenerate(options.model ?? 'llama2', prompt, options);
    return { ...result, provider: 'ollama' };
  }

  if (options?.provider === 'lmstudio') {
    const result = await lmstudioGenerate(
      options.model ?? 'local-model',
      [{ role: 'user', content: prompt }],
      options,
    );
    return { ...result, provider: 'lmstudio' };
  }

  // Try Ollama first, then LM Studio
  const ollamaStatus = await checkOllamaStatus();
  if (ollamaStatus.status === 'connected' && ollamaStatus.models.length > 0) {
    const model = options?.model ?? ollamaStatus.models[0].id;
    const result = await ollamaGenerate(model, prompt, options);
    return { ...result, provider: 'ollama' };
  }

  const lmstudioStatus = await checkLMStudioStatus();
  if (lmstudioStatus.status === 'connected' && lmstudioStatus.models.length > 0) {
    const model = options?.model ?? lmstudioStatus.models[0].id;
    const result = await lmstudioGenerate(
      model,
      [{ role: 'user', content: prompt }],
      options,
    );
    return { ...result, provider: 'lmstudio' };
  }

  return {
    success: false,
    error: 'No local model providers available',
  };
}

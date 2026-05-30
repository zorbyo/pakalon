import { DEFAULT_FREE_MODEL_ID } from '@/constants/models.js';
import { APIError, AuthenticationError, InvalidRequestError, OverloadedError, RateLimitError, ServiceUnavailableError } from '@/errors/index.js';

export type ProviderName = 'openrouter' | 'anthropic' | 'openai' | 'deepseek' | 'ollama' | 'lmstudio' | 'gemini';

export interface ProviderConfig {
  name: ProviderName;
  displayName: string;
  baseURL: string;
  apiKeyEnvVar: string;
  modelListEndpoint: string;
  chatCompletionEndpoint: string;
  modelAliases: Record<string, string>;
  defaultModel: string;
  headers?: Record<string, string>;
}

export interface MessageFormat {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface StreamingChunk {
  type: 'text' | 'tool-call' | 'done' | 'error';
  delta?: string;
  raw?: string;
  error?: string;
}

export interface ProviderClient {
  readonly config: ProviderConfig;
  resolveModel(modelAlias: string): string;
  listModels(env?: Record<string, string>): Promise<string[]>;
  chat(messages: MessageFormat[], options?: { model?: string; temperature?: number; maxTokens?: number; env?: Record<string, string> }): Promise<string>;
  streamChat(messages: MessageFormat[], options?: { model?: string; temperature?: number; maxTokens?: number; env?: Record<string, string> }): AsyncIterable<StreamingChunk>;
}

interface NormalizedResponse {
  status: number;
  ok: boolean;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}

function getGlobalFetch(): typeof fetch {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is not available in this runtime');
  }

  return fetch.bind(globalThis);
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function buildURL(baseURL: string, endpoint: string): string {
  const cleanedBase = trimTrailingSlash(baseURL);
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }

  return `${cleanedBase}/${endpoint.replace(/^\//, '')}`;
}

function responseError(response: NormalizedResponse, body: string): Error {
  if (response.status === 401) {
    return new AuthenticationError(body || 'Authentication failed');
  }

  if (response.status === 400) {
    return new InvalidRequestError(body || 'Invalid request');
  }

  if (response.status === 429) {
    return new RateLimitError(body || 'Rate limit exceeded');
  }

  if (response.status === 529) {
    return new OverloadedError(body || 'Provider overloaded');
  }

  if (response.status === 503) {
    return new ServiceUnavailableError(body || 'Service unavailable');
  }

  return new APIError(body || `Request failed with status ${response.status}`);
}

function parseTextFromJSONResponse(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) {
    return '';
  }

  const record = payload as Record<string, unknown>;
  const choices = record.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const firstChoice = choices[0];
    if (typeof firstChoice === 'object' && firstChoice !== null) {
      const choiceRecord = firstChoice as Record<string, unknown>;
      const message = choiceRecord.message;
      if (typeof message === 'object' && message !== null) {
        const messageRecord = message as Record<string, unknown>;
        const content = messageRecord.content;
        if (typeof content === 'string') {
          return content;
        }
      }

      const delta = choiceRecord.delta;
      if (typeof delta === 'object' && delta !== null) {
        const deltaRecord = delta as Record<string, unknown>;
        const content = deltaRecord.content;
        if (typeof content === 'string') {
          return content;
        }
      }
    }
  }

  const content = record.content;
  if (typeof content === 'string') {
    return content;
  }

  const text = record.text;
  if (typeof text === 'string') {
    return text;
  }

  return '';
}

function createJSONBody(messages: MessageFormat[], options: { model: string; temperature?: number; maxTokens?: number }): string {
  return JSON.stringify({
    model: options.model,
    messages,
    temperature: options.temperature,
    max_tokens: options.maxTokens,
    stream: false,
  });
}

function createProviderClientInternal(config: ProviderConfig): ProviderClient {
  const fetchFn = getGlobalFetch();

  const normalizeModel = (modelAlias: string): string => {
    return config.modelAliases[modelAlias] ?? config.modelAliases[modelAlias.toLowerCase()] ?? modelAlias;
  };

  const chat = async (
    messages: MessageFormat[],
    options?: { model?: string; temperature?: number; maxTokens?: number; env?: Record<string, string> }
  ): Promise<string> => {
    const apiKey = options?.env?.[config.apiKeyEnvVar] ?? process.env[config.apiKeyEnvVar];
    if (!apiKey && config.name !== 'ollama' && config.name !== 'lmstudio') {
      throw new AuthenticationError(`Missing ${config.apiKeyEnvVar}`);
    }

    const model = normalizeModel(options?.model ?? config.defaultModel);
    const endpoint = config.chatCompletionEndpoint.includes('{model}')
      ? config.chatCompletionEndpoint.replace('{model}', encodeURIComponent(model))
      : config.chatCompletionEndpoint;

    const response = await fetchFn(buildURL(config.baseURL, endpoint), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: createJSONBody(messages, { model, temperature: options?.temperature, maxTokens: options?.maxTokens }),
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw responseError(response as NormalizedResponse, bodyText);
    }

    try {
      return parseTextFromJSONResponse(JSON.parse(bodyText));
    } catch {
      return bodyText;
    }
  };

  const streamChat = async function* (
    messages: MessageFormat[],
    options?: { model?: string; temperature?: number; maxTokens?: number; env?: Record<string, string> }
  ): AsyncIterable<StreamingChunk> {
    try {
      const text = await chat(messages, options);
      yield { type: 'text', delta: text, raw: text };
      yield { type: 'done' };
    } catch (error) {
      yield { type: 'error', error: error instanceof Error ? error.message : String(error) };
    }
  };

  return {
    config,
    resolveModel(modelAlias: string): string {
      return normalizeModel(modelAlias);
    },
    listModels: async (env?: Record<string, string>): Promise<string[]> => {
      const apiKey = env?.[config.apiKeyEnvVar] ?? process.env[config.apiKeyEnvVar];
      const response = await fetchFn(buildURL(config.baseURL, config.modelListEndpoint), {
        method: 'GET',
        headers: {
          ...config.headers,
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
      });

      const bodyText = await response.text();
      if (!response.ok) {
        throw responseError(response as NormalizedResponse, bodyText);
      }

      try {
        const payload = JSON.parse(bodyText) as Record<string, unknown>;
        const data = payload.data;
        if (Array.isArray(data)) {
          return data
            .map((item) => {
              if (typeof item === 'object' && item !== null) {
                const record = item as Record<string, unknown>;
                const id = record.id;
                return typeof id === 'string' ? id : null;
              }

              return null;
            })
            .filter((value): value is string => value !== null);
        }
      } catch {
        return [];
      }

      return [];
    },
    chat,
    streamChat,
  };
}

export const ProviderRegistry: Readonly<Record<ProviderName, ProviderConfig>> = {
  openrouter: {
    name: 'openrouter',
    displayName: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    modelListEndpoint: '/models',
    chatCompletionEndpoint: '/chat/completions',
    modelAliases: {
      opus: 'anthropic/claude-3.5-opus',
      sonnet: 'anthropic/claude-3.5-sonnet',
      haiku: 'anthropic/claude-3.5-haiku',
      default: DEFAULT_FREE_MODEL_ID,
    },
    defaultModel: DEFAULT_FREE_MODEL_ID,
  },
  anthropic: {
    name: 'anthropic',
    displayName: 'Anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    modelListEndpoint: '/models',
    chatCompletionEndpoint: '/messages',
    modelAliases: {
      opus: 'claude-opus-4-20250514',
      sonnet: 'claude-sonnet-4-20250514',
      haiku: 'claude-3-5-haiku-20241022',
      default: 'claude-sonnet-4-20250514',
    },
    defaultModel: 'claude-sonnet-4-20250514',
    headers: { 'anthropic-version': '2023-06-01' },
  },
  openai: {
    name: 'openai',
    displayName: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    modelListEndpoint: '/models',
    chatCompletionEndpoint: '/chat/completions',
    modelAliases: {
      opus: 'gpt-4.1',
      sonnet: 'gpt-4.1-mini',
      haiku: 'gpt-4o-mini',
      default: 'gpt-4.1',
    },
    defaultModel: 'gpt-4.1',
  },
  deepseek: {
    name: 'deepseek',
    displayName: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
    modelListEndpoint: '/models',
    chatCompletionEndpoint: '/chat/completions',
    modelAliases: {
      opus: 'deepseek-reasoner',
      sonnet: 'deepseek-chat',
      haiku: 'deepseek-chat',
      default: 'deepseek-chat',
    },
    defaultModel: 'deepseek-chat',
  },
  ollama: {
    name: 'ollama',
    displayName: 'Ollama',
    baseURL: 'http://localhost:11434',
    apiKeyEnvVar: 'OLLAMA_API_KEY',
    modelListEndpoint: '/api/tags',
    chatCompletionEndpoint: '/api/chat',
    modelAliases: {
      opus: 'qwen2.5-coder:32b',
      sonnet: 'qwen2.5-coder:14b',
      haiku: 'llama3.2:3b',
      default: 'llama3.2:3b',
    },
    defaultModel: 'llama3.2:3b',
  },
  lmstudio: {
    name: 'lmstudio',
    displayName: 'LM Studio',
    baseURL: 'http://localhost:1234/v1',
    apiKeyEnvVar: 'LM_STUDIO_API_KEY',
    modelListEndpoint: '/models',
    chatCompletionEndpoint: '/chat/completions',
    modelAliases: {
      opus: 'local-model',
      sonnet: 'local-model',
      haiku: 'local-model',
      default: 'local-model',
    },
    defaultModel: 'local-model',
  },
  gemini: {
    name: 'gemini',
    displayName: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    modelListEndpoint: '/models',
    chatCompletionEndpoint: '/models/{model}:generateContent',
    modelAliases: {
      opus: 'gemini-2.5-pro',
      sonnet: 'gemini-2.5-flash',
      haiku: 'gemini-2.5-flash-lite',
      default: 'gemini-2.5-flash',
    },
    defaultModel: 'gemini-2.5-flash',
  },
};

export function createProviderClient(providerName: string): ProviderClient {
  const normalized = providerName.toLowerCase() as ProviderName;
  const config = ProviderRegistry[normalized];

  if (!config) {
    throw new Error(`Unknown provider: ${providerName}`);
  }

  return createProviderClientInternal(config);
}

export function getProviderConfig(providerName: string): ProviderConfig {
  const normalized = providerName.toLowerCase() as ProviderName;
  const config = ProviderRegistry[normalized];

  if (!config) {
    throw new Error(`Unknown provider: ${providerName}`);
  }

  return config;
}

// Re-export new modules
export { healthChecker, checkProviderHealth, checkAllProvidersHealth, getProviderHealth, isProviderHealthy } from './health.js';
export { modelSelector, selectModel, getModelSelectorStatus } from './selector.js';
export { gracefulDegradation, executeWithFallback, chatWithFallback, streamChatWithFallback, getFallbackChain } from './degradation.js';
export { metricsCollector, recordMetric, recordProviderLatency, recordTokenUsage, recordProviderHealth, recordError, recordFeatureUsage, flushMetrics } from './metrics.js';

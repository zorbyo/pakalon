/**
 * OpenRouter integration using Vercel AI SDK + @openrouter/ai-sdk-provider.
 *
 * Supports two routing modes:
 *   1. Direct — calls OpenRouter using a local apiKey (OPENROUTER_API_KEY)
 *   2. Proxy  — routes requests through the Pakalon backend (/ai/chat/stream)
 *              using the backend's OPENROUTER_MASTER_KEY. No per-user key needed.
 *
 * Proxy mode is activated when:
 *   - `useProxy: true` is passed explicitly, OR
 *   - PAKALON_USE_PROXY=1 env var is set, OR
 *   - apiKey is empty/undefined
 */
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { streamText, generateText } from "ai";
import type { JSONValue, ModelMessage as CoreMessage, ToolSet } from "ai";
import type {
  EffortLevel,
  ModelEffortConfig,
  PrivacyLevel,
} from "@/store/slices/mode.slice.js";
import { getSupportedEffortProvider } from "@/utils/model-effort.js";
import { isSelfHosted } from "@/config/mode.js";
import { generateLocalCompletion, streamLocalCompletion } from "@/ai/local/discovery.js";

let _provider: ReturnType<typeof createOpenRouter> | null = null;
const MAX_TRANSIENT_PROVIDER_RETRIES = 4;
const TRANSIENT_RETRY_BASE_DELAY_MS = 750;
const TRANSIENT_RETRY_MAX_DELAY_MS = 6000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTransientRetryDelayMs(attempt: number): number {
  return Math.min(
    TRANSIENT_RETRY_MAX_DELAY_MS,
    TRANSIENT_RETRY_BASE_DELAY_MS * 2 ** attempt,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractStatusCode(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;

  const direct = error.status ?? error.statusCode;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;

  const response = error.response;
  if (isRecord(response)) {
    const responseStatus = response.status ?? response.statusCode;
    if (typeof responseStatus === "number" && Number.isFinite(responseStatus)) {
      return responseStatus;
    }
  }

  const cause = error.cause;
  if (isRecord(cause)) {
    const causeDirect = cause.status ?? cause.statusCode;
    if (typeof causeDirect === "number" && Number.isFinite(causeDirect)) return causeDirect;
    const causeResponse = cause.response;
    if (isRecord(causeResponse)) {
      const causeStatus = causeResponse.status ?? causeResponse.statusCode;
      if (typeof causeStatus === "number" && Number.isFinite(causeStatus)) {
        return causeStatus;
      }
    }
  }

  return undefined;
}

function extractErrorDetail(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  if (isRecord(error)) {
    if (typeof error.detail === "string" && error.detail.trim()) return error.detail;
    if (typeof error.message === "string" && error.message.trim()) return error.message;
  }
  return String(error);
}

function isTransientProviderFailure(status?: number, detail = ""): boolean {
  const normalized = detail.toLowerCase();
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    normalized.includes("upstream ai provider error: 503") ||
    normalized.includes("provider error: 503") ||
    normalized.includes("temporarily unavailable") ||
    normalized.includes("overloaded") ||
    normalized.includes("rate limit")
  );
}

function formatProviderFailure(detail: string, status?: number): string {
  if (isTransientProviderFailure(status, detail)) {
    return (
      "AI provider is temporarily unavailable" +
      (status ? ` (${status})` : "") +
      ". Pakalon retried the request. Try again in a moment or switch models with `/models`."
    );
  }
  return detail;
}

export function getOpenRouterProvider(apiKey: string) {
  if (!_provider) {
    _provider = createOpenRouter({ apiKey });
  }
  return _provider;
}

export function resetProvider() {
  _provider = null;
}

function normalizeOpenRouterEffort(effort?: EffortLevel): string {
  if (effort === "extra-high") return "xhigh";
  return effort ?? "high";
}

function inferProviderFromModel(model: string): string | undefined {
  return model.includes("/") ? model.split("/")[0] : undefined;
}

function buildReasoningConfig(
  model: string,
  modelEffortConfig?: ModelEffortConfig | null,
): Record<string, JSONValue> | null {
  const provider = getSupportedEffortProvider({
    id: model,
    provider: inferProviderFromModel(model),
  });
  if (!provider) return null;

  if (provider === "anthropic") {
    if (
      modelEffortConfig?.provider === "anthropic" &&
      modelEffortConfig.mode === "default"
    ) {
      return null;
    }
    return { max_tokens: 4096 };
  }

  if (provider === "gemini") {
    return {
      effort: normalizeOpenRouterEffort(
        modelEffortConfig?.provider === "gemini"
          ? modelEffortConfig.effort
          : "high",
      ),
    };
  }

  return {
    effort: normalizeOpenRouterEffort(
      modelEffortConfig?.provider === "openai"
        ? modelEffortConfig.effort
        : "high",
    ),
  };
}

function buildOpenRouterProviderOptions(
  opts: Pick<StreamOptions, "model" | "thinkingEnabled" | "modelEffortConfig">,
  privacyHeaders: Record<string, string>,
  enableCache: boolean,
  cacheSystemExtra?: Record<string, JSONValue>,
): { providerOptions: { openrouter: Record<string, JSONValue> } } {
  const reasoning = opts.thinkingEnabled
    ? buildReasoningConfig(opts.model, opts.modelEffortConfig)
    : null;

  return {
    providerOptions: {
      openrouter: {
        ...(reasoning ? { reasoning } : {}),
        extraHeaders: {
          ...privacyHeaders,
          ...(enableCache
            ? { "anthropic-beta": "prompt-caching-2024-07-31" }
            : {}),
        },
        ...(cacheSystemExtra ?? {}),
      },
    },
  };
}

export interface StreamOptions {
  model: string;
  messages: CoreMessage[];
  apiKey?: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  /** When true, enables extended reasoning via OpenRouter provider options (T-CLI-19) */
  thinkingEnabled?: boolean;
  modelEffortConfig?: ModelEffortConfig | null;
  /** Privacy level: off (default), metadata (headers only), full (block telemetry too) */
  privacyLevel?: PrivacyLevel;
  /**
   * When true (or when PAKALON_USE_PROXY=1 / no apiKey), routes inference
   * through the Pakalon backend proxy instead of calling OpenRouter directly.
   */
  useProxy?: boolean;
  /** Backend JWT token — required for proxy mode */
  authToken?: string;
  /** Pakalon backend base URL (default: PAKALON_API_URL env) */
  proxyBaseUrl?: string;
  /**
   * Additional tools to inject into the AI inference (e.g. from MCP servers).
   * Only used in direct OpenRouter mode (ignored in proxy mode).
   */
  tools?: ToolSet;
  /**
   * Max agentic steps for tool calling. Default: 5 (direct mode only).
   */
  maxSteps?: number;
  /**
   * When true, inject Anthropic prompt-caching cache_control breakpoints.
   * Reduces inference cost by up to 90% on repeated long contexts (T-CLI-CACHE).
   * Only effective with anthropic/* models via OpenRouter.
   */
  promptCaching?: boolean;
  onChunk?: (chunk: string) => void;
  onFinish?: (fullText: string, usage: { promptTokens: number; completionTokens: number }) => void;
  onError?: (err: Error) => void;
}

// ---------------------------------------------------------------------------
// T-CLI-CACHE: Prompt caching helpers — inject cache_control breakpoints
// for Anthropic models. Reduces inference cost by caching the system prompt
// and large stable context blocks.
// ---------------------------------------------------------------------------

/**
 * Inject Anthropic cache_control: { type: "ephemeral" } breakpoints into the
 * message array so OpenRouter (Anthropic backend) reuses the KV-cache.
 *
 * Strategy:
 * 1. Always mark the system prompt as cached (largest stable block).
 * 2. Mark the first user message (often has PAKALON.md + file context) as cached.
 * 3. Keep the last 2 turns un-cached (dynamic new content).
 *
 * This approach is invisible to non-Anthropic models — OpenRouter ignores
 * cache_control on providers that don't support it.
 */
function injectPromptCachingBreakpoints(
  messages: CoreMessage[],
  systemPrompt?: string
): { messages: CoreMessage[]; cacheSystemPrompt: Record<string, JSONValue> | undefined } {
  if (messages.length === 0) return { messages, cacheSystemPrompt: undefined };

  // Mark system prompt with cache_control
  const cacheSystemPrompt = systemPrompt
    ? { cache_control: { type: "ephemeral" } }
    : undefined;

  const out: CoreMessage[] = [];

  // Mark the first user message (stable context block) as cached
  let cachedFirst = false;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    const role = (m as { role?: string }).role;
    const isLast2 = i >= messages.length - 2;

    if (role === "user" && !cachedFirst && !isLast2) {
      // Deep-clone and add cache_control to the last content part
      const content = typeof m.content === "string"
        ? [{ type: "text" as const, text: m.content, cache_control: { type: "ephemeral" } }]
        : Array.isArray(m.content)
          ? m.content.map((part, pi) =>
              pi === (m.content as unknown[]).length - 1
                ? { ...(part as object), cache_control: { type: "ephemeral" } }
                : part
            )
          : m.content;
      out.push({ ...m, content } as CoreMessage);
      cachedFirst = true;
    } else {
      out.push(m);
    }
  }

  return { messages: out, cacheSystemPrompt };
}

/** Return true if the model is an Anthropic model (caching supported). */
function isAnthropicModel(model: string): boolean {
  return model.startsWith("anthropic/") || model.includes("claude");
}

function isProxyMode(opts: StreamOptions): boolean {
  if (opts.useProxy) return true;
  if (process.env.PAKALON_USE_PROXY === "1") return true;
  if (!opts.apiKey) return true;
  return false;
}

/**
 * Fallback path when proxy streaming exhausts retries:
 * attempt the backend non-streaming endpoint once before surfacing an error.
 */
async function tryProxyNonStreamingFallback(opts: StreamOptions): Promise<boolean> {
  if (!isProxyMode(opts)) return false;

  try {
    const fallback = await generateCompletion({
      model: opts.model,
      messages: opts.messages,
      apiKey: opts.apiKey,
      system: opts.system,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      thinkingEnabled: opts.thinkingEnabled,
      modelEffortConfig: opts.modelEffortConfig,
      privacyLevel: opts.privacyLevel,
      useProxy: true,
      authToken: opts.authToken,
      proxyBaseUrl: opts.proxyBaseUrl,
      tools: opts.tools,
      maxSteps: opts.maxSteps,
      promptCaching: opts.promptCaching,
    });

    if (fallback.text) {
      opts.onChunk?.(fallback.text);
    }
    opts.onFinish?.(fallback.text, {
      promptTokens: fallback.promptTokens,
      completionTokens: fallback.completionTokens,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Stream via the Pakalon backend AI proxy endpoint.
 * The backend holds the master OpenRouter key — users supply only their JWT.
 */
async function streamViaProxy(opts: StreamOptions, attempt = 0): Promise<void> {
  const baseUrl = opts.proxyBaseUrl ?? process.env.PAKALON_API_URL ?? "http://127.0.0.1:8000";
  const url = `${baseUrl}/ai/chat/stream`;
  const token = opts.authToken ?? process.env.PAKALON_TOKEN ?? "";
  const reasoning = opts.thinkingEnabled
    ? buildReasoningConfig(opts.model, opts.modelEffortConfig)
    : null;

  const body = {
    model: opts.model,
    messages: opts.messages,
    system: opts.system,
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.7,
    thinking_enabled: reasoning !== null,
    ...(reasoning ? { reasoning } : {}),
    privacy_mode: (opts.privacyLevel && opts.privacyLevel !== "off") ? true : false,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const json = (await res.json()) as { detail?: string };
      if (json.detail) detail = json.detail;
    } catch { /* ignore */ }
    
    if (isTransientProviderFailure(res.status, detail) && attempt < MAX_TRANSIENT_PROVIDER_RETRIES) {
      await wait(getTransientRetryDelayMs(attempt));
      return streamViaProxy(opts, attempt + 1);
    }

    // T-CLI-404-FIX: Try direct OpenRouter mode as fallback when proxy fails
    // This handles cases where backend is unavailable or returns 404
    if ((res.status === 404 || res.status >= 500) && opts.apiKey) {
      console.warn(`[OpenRouter] Proxy failed (${res.status}), falling back to direct mode`);
      return streamViaDirect(opts);
    }

    if (isTransientProviderFailure(res.status, detail)) {
      const recovered = await tryProxyNonStreamingFallback(opts);
      if (recovered) return;
    }
    
    opts.onError?.(new Error(formatProviderFailure(detail, res.status)));
    return;
  }

  if (!res.body) {
    opts.onError?.(new Error("No response body from proxy"));
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let promptTokens = 0;
  let completionTokens = 0;
  let lineBuffer = "";
  let lockReleased = false;
  const releaseReaderForRetry = async () => {
    try {
      await reader.cancel();
    } catch {
      // ignore cancellation errors before retry/fallback
    }
    if (!lockReleased) {
      reader.releaseLock();
      lockReleased = true;
    }
  };

  const handleEventPayload = (payload: string): Error | null => {
    if (!payload || payload === "[DONE]") {
      return null;
    }

    try {
      const event = JSON.parse(payload) as {
        type?: string;
        chunk?: string;
        content?: string;
        text?: string;
        reasoning?: string;
        reasoning_content?: string;
        thinking?: string;
        delta?: unknown;
        detail?: string;
        error?: { message?: string } | string;
        prompt_tokens?: number;
        completion_tokens?: number;
      };

      const delta = isRecord(event.delta) ? event.delta : null;
      const reasoningChunk =
        event.reasoning ??
        event.reasoning_content ??
        event.thinking ??
        (typeof delta?.reasoning === "string" ? delta.reasoning : undefined) ??
        (typeof delta?.reasoning_content === "string" ? delta.reasoning_content : undefined) ??
        (typeof delta?.thinking === "string" ? delta.thinking : undefined) ??
        "";

      if (event.type === "reasoning_delta" || event.type === "thinking_delta" || reasoningChunk) {
        if (reasoningChunk) {
          opts.onChunk?.(`<think>${reasoningChunk}</think>`);
        }
        return null;
      }

      const chunk =
        event.chunk ??
        event.content ??
        event.text ??
        (typeof delta?.content === "string" ? delta.content : undefined) ??
        (typeof delta?.text === "string" ? delta.text : undefined) ??
        "";
      if (event.type === "chunk" || event.type === "text_delta" || Boolean(chunk)) {
        if (chunk) {
          fullText += chunk;
          opts.onChunk?.(chunk);
        }
        return null;
      }

      if (event.type === "done" || event.type === "usage") {
        promptTokens = event.prompt_tokens ?? promptTokens;
        completionTokens = event.completion_tokens ?? completionTokens;
        return null;
      }

      if (event.type === "error" || event.error) {
        const detail =
          event.detail ??
          (typeof event.error === "string"
            ? event.error
            : event.error?.message) ??
          "Stream error";
        return new Error(detail);
      }
    } catch {
      // Ignore malformed lines and SSE comments from upstream/proxy.
    }

    return null;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      lineBuffer += decoder.decode(value, { stream: true });

      let newlineIndex = lineBuffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const rawLine = lineBuffer.slice(0, newlineIndex).replace(/\r$/, "");
        lineBuffer = lineBuffer.slice(newlineIndex + 1);

        if (rawLine.startsWith(":")) {
          newlineIndex = lineBuffer.indexOf("\n");
          continue;
        }
        if (!rawLine.startsWith("data:")) {
          newlineIndex = lineBuffer.indexOf("\n");
          continue;
        }

        const payload = rawLine.slice(5).trim();
        const err = handleEventPayload(payload);
        if (err) {
          if (fullText.length === 0 && isTransientProviderFailure(undefined, err.message)) {
            await releaseReaderForRetry();
            if (attempt < MAX_TRANSIENT_PROVIDER_RETRIES) {
              await wait(getTransientRetryDelayMs(attempt));
              return streamViaProxy(opts, attempt + 1);
            }
            if (opts.apiKey) {
              return streamViaDirect(opts);
            }
            const recovered = await tryProxyNonStreamingFallback(opts);
            if (recovered) return;
          }
          opts.onError?.(new Error(formatProviderFailure(err.message)));
          return;
        }

        newlineIndex = lineBuffer.indexOf("\n");
      }
    }

    const trailing = lineBuffer.trim();
    if (trailing.startsWith("data:")) {
      const err = handleEventPayload(trailing.slice(5).trim());
      if (err) {
        if (fullText.length === 0 && isTransientProviderFailure(undefined, err.message)) {
          await releaseReaderForRetry();
          if (attempt < MAX_TRANSIENT_PROVIDER_RETRIES) {
            await wait(getTransientRetryDelayMs(attempt));
            return streamViaProxy(opts, attempt + 1);
          }
          if (opts.apiKey) {
            return streamViaDirect(opts);
          }
          const recovered = await tryProxyNonStreamingFallback(opts);
          if (recovered) return;
        }
        opts.onError?.(new Error(formatProviderFailure(err.message)));
        return;
      }
    }
  } finally {
    if (!lockReleased) {
      reader.releaseLock();
    }
  }

  opts.onFinish?.(fullText, { promptTokens, completionTokens });
}

// T-CLI-404-FIX: Fallback function for direct OpenRouter streaming when proxy fails
async function streamViaDirect(opts: StreamOptions, attempt = 0): Promise<void> {
  if (!opts.apiKey) {
    opts.onError?.(new Error("No API key available for direct OpenRouter mode"));
    return;
  }

  const provider = getOpenRouterProvider(opts.apiKey);
  const modelInstance = provider(opts.model);

  const privacyHeaders: Record<string, string> = opts.privacyLevel && opts.privacyLevel !== "off"
    ? { "X-OpenRouter-No-Prompt-Training": "true", "X-Privacy-Mode": "1" }
    : {};

  const enableCache = (opts.promptCaching ?? true) && isAnthropicModel(opts.model);
  let finalMessages = opts.messages;
  let cacheSystemExtra: Record<string, JSONValue> | undefined;
  if (enableCache) {
    const cached = injectPromptCachingBreakpoints(opts.messages, opts.system);
    finalMessages = cached.messages;
    cacheSystemExtra = cached.cacheSystemPrompt;
  }

  try {
    const result = await streamText({
      model: modelInstance,
      messages: finalMessages,
      system: opts.system,
      maxOutputTokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.7,
      ...(opts.tools ? { tools: opts.tools, maxSteps: opts.maxSteps ?? 5 } : {}),
      ...buildOpenRouterProviderOptions(
        opts,
        privacyHeaders,
        enableCache,
        cacheSystemExtra,
      ),
    });

    let full = "";
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        full += part.text;
        opts.onChunk?.(part.text);
      } else if (part.type === "reasoning-delta" && part.text) {
        opts.onChunk?.(`<think>${part.text}</think>`);
      } else if (part.type === "error") {
        throw part.error;
      }
    }

    const usage = await result.usage;
    opts.onFinish?.(full, {
      promptTokens: usage?.inputTokens ?? 0,
      completionTokens: usage?.outputTokens ?? 0,
    });
  } catch (err) {
    const detail = extractErrorDetail(err);
    const status = extractStatusCode(err);
    if (isTransientProviderFailure(status, detail) && attempt < MAX_TRANSIENT_PROVIDER_RETRIES) {
      await wait(getTransientRetryDelayMs(attempt));
      return streamViaDirect(opts, attempt + 1);
    }
    opts.onError?.(new Error(formatProviderFailure(detail, status)));
  }
}

// T-CLI-404-FIX: Direct mode generator for fallback
async function generateViaDirect(
  opts: Omit<StreamOptions, "onChunk" | "onFinish" | "onError">,
  attempt = 0,
): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
  if (!opts.apiKey) {
    throw new Error("No API key available for direct OpenRouter mode");
  }

  const provider = getOpenRouterProvider(opts.apiKey);
  const modelInstance = provider(opts.model);

  const privacyHeaders: Record<string, string> = opts.privacyLevel && opts.privacyLevel !== "off"
    ? { "X-OpenRouter-No-Prompt-Training": "true", "X-Privacy-Mode": "1" }
    : {};

  try {
    const result = await generateText({
      model: modelInstance,
      messages: opts.messages,
      system: opts.system,
      maxOutputTokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.7,
      ...buildOpenRouterProviderOptions(opts, privacyHeaders, false),
    });

    return {
      text: result.text,
      promptTokens: result.usage?.inputTokens ?? 0,
      completionTokens: result.usage?.outputTokens ?? 0,
    };
  } catch (err) {
    const detail = extractErrorDetail(err);
    const status = extractStatusCode(err);
    if (isTransientProviderFailure(status, detail) && attempt < MAX_TRANSIENT_PROVIDER_RETRIES) {
      await wait(getTransientRetryDelayMs(attempt));
      return generateViaDirect(opts, attempt + 1);
    }
    throw new Error(formatProviderFailure(detail, status));
  }
}

export async function streamCompletion(opts: StreamOptions): Promise<void> {
  if (isSelfHosted()) {
    try {
      return await streamLocalCompletion({
        model: opts.model,
        messages: opts.messages,
        system: opts.system,
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
        onChunk: opts.onChunk,
        onFinish: opts.onFinish,
        onError: opts.onError,
      });
    } catch (err) {
      opts.onError?.(err instanceof Error ? err : new Error(String(err)));
      return;
    }
  }

  if (isProxyMode(opts)) {
    return streamViaProxy(opts);
  }

  return streamViaDirect(opts);
}

export async function generateCompletion(
  opts: Omit<StreamOptions, "onChunk" | "onFinish" | "onError">,
  proxyAttempt = 0,
): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
  if (isSelfHosted()) {
    return generateLocalCompletion({
      model: opts.model,
      messages: opts.messages,
      system: opts.system,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
    });
  }

  // Proxy mode: one-shot via /ai/chat (non-streaming)
  if (isProxyMode(opts)) {
    const baseUrl = opts.proxyBaseUrl ?? process.env.PAKALON_API_URL ?? "http://127.0.0.1:8000";
    const token = opts.authToken ?? process.env.PAKALON_TOKEN ?? "";
    const reasoning = opts.thinkingEnabled
      ? buildReasoningConfig(opts.model, opts.modelEffortConfig)
      : null;
    const res = await fetch(`${baseUrl}/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        system: opts.system,
        max_tokens: opts.maxTokens ?? 4096,
        temperature: opts.temperature ?? 0.7,
        thinking_enabled: reasoning !== null,
        ...(reasoning ? { reasoning } : {}),
    privacy_mode: (opts.privacyLevel && opts.privacyLevel !== "off") ? true : false,
      }),
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      let detail = `HTTP ${res.status}`;
      try {
        const parsed = raw ? (JSON.parse(raw) as { detail?: string }) : null;
        if (parsed?.detail) detail = parsed.detail;
      } catch {
        if (raw.trim()) detail = raw.trim();
      }

      if (isTransientProviderFailure(res.status, detail) && proxyAttempt < MAX_TRANSIENT_PROVIDER_RETRIES) {
        await wait(getTransientRetryDelayMs(proxyAttempt));
        return generateCompletion(opts, proxyAttempt + 1);
      }

      // T-CLI-404-FIX: Try direct mode as fallback for 404 or 5xx errors
      if ((res.status === 404 || res.status >= 500) && opts.apiKey) {
        console.warn(`[OpenRouter] Proxy generate failed (${res.status}), falling back to direct mode`);
        try {
          return await generateViaDirect(opts);
        } catch {
          // surface original non-streaming error when fallback also fails
        }
      }

      throw new Error(formatProviderFailure(detail, res.status));
    }
    try {
      const data = (await res.json()) as { content: string; prompt_tokens: number; completion_tokens: number };
      return { text: data.content, promptTokens: data.prompt_tokens, completionTokens: data.completion_tokens };
    } catch {
      return generateViaDirect(opts);
    }
  }

  return generateViaDirect(opts);
}

import type { ModelMessage as CoreMessage } from "ai";
import type { LocalCompletionOptions, LocalModel } from "@/ai/local/types.js";

interface LMStudioModelRecord {
  id: string;
  name?: string;
  max_context_length?: number;
  context_length?: number;
  owned_by?: string;
}

interface OpenAIStreamEvent {
  choices?: Array<{
    delta?: { content?: string; reasoning_content?: string };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: { message?: string } | string;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function contentToText(content: CoreMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content);
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        return part.text;
      }
      return JSON.stringify(part);
    })
    .join("\n");
}

function toOpenAIMessages(messages: CoreMessage[], system?: string) {
  const mapped = messages.map((message) => ({
    role: message.role === "assistant" || message.role === "system" ? message.role : "user",
    content: contentToText(message.content),
  }));

  if (system?.trim()) {
    return [{ role: "system", content: system }, ...mapped];
  }

  return mapped;
}

function inferParameters(modelId: string): string | undefined {
  return modelId.match(/\b(\d+(?:\.\d+)?b)\b/i)?.[1]?.toUpperCase();
}

export async function discoverLMStudioModels(baseUrl: string): Promise<LocalModel[]> {
  const response = await fetch(`${trimTrailingSlash(baseUrl)}/v1/models`);
  if (!response.ok) {
    throw new Error(`LM Studio discovery failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { data?: LMStudioModelRecord[] };
  return (data.data ?? []).map((model) => ({
    id: `lmstudio:${model.id}`,
    name: model.id,
    provider: "lmstudio",
    baseUrl: trimTrailingSlash(baseUrl),
    contextWindow: model.max_context_length ?? model.context_length ?? 32768,
    parameters: inferParameters(model.id),
    family: model.owned_by,
  }));
}

export async function streamLMStudioCompletion(opts: LocalCompletionOptions): Promise<void> {
  const response = await fetch(`${trimTrailingSlash(opts.model.baseUrl)}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model.name,
      messages: toOpenAIMessages(opts.messages, opts.system),
      stream: true,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 4096,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`LM Studio chat failed: HTTP ${response.status}${detail ? ` - ${detail}` : ""}`);
  }

  if (!response.body) {
    throw new Error("LM Studio chat returned no response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let lineBuffer = "";
  let fullText = "";
  let promptTokens = 0;
  let completionTokens = 0;

  const handlePayload = (payload: string) => {
    if (!payload || payload === "[DONE]") return;
    const event = JSON.parse(payload) as OpenAIStreamEvent;
    if (event.error) {
      throw new Error(typeof event.error === "string" ? event.error : event.error.message ?? "LM Studio stream error");
    }
    const delta = event.choices?.[0]?.delta;
    const chunk = delta?.content ?? delta?.reasoning_content ?? "";
    if (chunk) {
      fullText += chunk;
      opts.onChunk?.(chunk);
    }
    promptTokens = event.usage?.prompt_tokens ?? promptTokens;
    completionTokens = event.usage?.completion_tokens ?? completionTokens;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuffer += decoder.decode(value, { stream: true });
      let newlineIndex = lineBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const rawLine = lineBuffer.slice(0, newlineIndex).replace(/\r$/, "");
        lineBuffer = lineBuffer.slice(newlineIndex + 1);
        if (rawLine.startsWith("data:")) {
          handlePayload(rawLine.slice(5).trim());
        }
        newlineIndex = lineBuffer.indexOf("\n");
      }
    }
    const trailing = lineBuffer.trim();
    if (trailing.startsWith("data:")) {
      handlePayload(trailing.slice(5).trim());
    }
    opts.onFinish?.(fullText, { promptTokens, completionTokens });
  } finally {
    reader.releaseLock();
  }
}

export async function generateLMStudioCompletion(
  opts: Omit<LocalCompletionOptions, "onChunk" | "onFinish" | "onError">,
): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
  const response = await fetch(`${trimTrailingSlash(opts.model.baseUrl)}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model.name,
      messages: toOpenAIMessages(opts.messages, opts.system),
      stream: false,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 4096,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`LM Studio chat failed: HTTP ${response.status}${detail ? ` - ${detail}` : ""}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  return {
    text: data.choices?.[0]?.message?.content ?? "",
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
  };
}

import type { ModelMessage as CoreMessage } from "ai";
import type { LocalCompletionOptions, LocalModel } from "@/ai/local/types.js";

interface OllamaTag {
  name: string;
  size?: number;
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
    context_length?: number;
  };
}

interface OllamaChatEvent {
  message?: { content?: string };
  response?: string;
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
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

function toOllamaMessages(messages: CoreMessage[], system?: string) {
  const mapped = messages.map((message) => ({
    role: message.role === "assistant" || message.role === "system" ? message.role : "user",
    content: contentToText(message.content),
  }));

  if (system?.trim()) {
    return [{ role: "system", content: system }, ...mapped];
  }

  return mapped;
}

export async function discoverOllamaModels(baseUrl: string): Promise<LocalModel[]> {
  const response = await fetch(`${trimTrailingSlash(baseUrl)}/api/tags`);
  if (!response.ok) {
    throw new Error(`Ollama discovery failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { models?: OllamaTag[] };
  return (data.models ?? []).map((model) => ({
    id: `ollama:${model.name}`,
    name: model.name,
    provider: "ollama",
    baseUrl: trimTrailingSlash(baseUrl),
    contextWindow: model.details?.context_length ?? 32768,
    parameters: model.details?.parameter_size,
    quantization: model.details?.quantization_level,
    size: model.size,
    family: model.details?.family,
  }));
}

export async function streamOllamaCompletion(opts: LocalCompletionOptions): Promise<void> {
  const response = await fetch(`${trimTrailingSlash(opts.model.baseUrl)}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model.name,
      messages: toOllamaMessages(opts.messages, opts.system),
      stream: true,
      options: {
        temperature: opts.temperature ?? 0.7,
        num_predict: opts.maxTokens ?? 4096,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Ollama chat failed: HTTP ${response.status}${detail ? ` - ${detail}` : ""}`);
  }

  if (!response.body) {
    throw new Error("Ollama chat returned no response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let promptTokens = 0;
  let completionTokens = 0;

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const event = JSON.parse(trimmed) as OllamaChatEvent;
    if (event.error) throw new Error(event.error);
    const chunk = event.message?.content ?? event.response ?? "";
    if (chunk) {
      fullText += chunk;
      opts.onChunk?.(chunk);
    }
    promptTokens = event.prompt_eval_count ?? promptTokens;
    completionTokens = event.eval_count ?? completionTokens;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        handleLine(line);
        newlineIndex = buffer.indexOf("\n");
      }
    }
    if (buffer.trim()) handleLine(buffer);
    opts.onFinish?.(fullText, { promptTokens, completionTokens });
  } finally {
    reader.releaseLock();
  }
}

export async function generateOllamaCompletion(
  opts: Omit<LocalCompletionOptions, "onChunk" | "onFinish" | "onError">,
): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
  const response = await fetch(`${trimTrailingSlash(opts.model.baseUrl)}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model.name,
      messages: toOllamaMessages(opts.messages, opts.system),
      stream: false,
      options: {
        temperature: opts.temperature ?? 0.7,
        num_predict: opts.maxTokens ?? 4096,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Ollama chat failed: HTTP ${response.status}${detail ? ` - ${detail}` : ""}`);
  }

  const data = (await response.json()) as OllamaChatEvent;
  return {
    text: data.message?.content ?? data.response ?? "",
    promptTokens: data.prompt_eval_count ?? 0,
    completionTokens: data.eval_count ?? 0,
  };
}

import type { ModelMessage as CoreMessage } from "ai";

export type LocalProviderName = "ollama" | "lmstudio";

export interface LocalModel {
  id: string;
  name: string;
  provider: LocalProviderName;
  baseUrl: string;
  contextWindow: number;
  parameters?: string;
  quantization?: string;
  size?: number;
  family?: string;
}

export interface LocalProviderConfig {
  ollama?: { baseUrl: string; enabled: boolean };
  lmstudio?: { baseUrl: string; enabled: boolean };
}

export interface LocalCompletionOptions {
  model: LocalModel;
  messages: CoreMessage[];
  system?: string;
  temperature?: number;
  maxTokens?: number;
  onChunk?: (chunk: string) => void;
  onFinish?: (fullText: string, usage: { promptTokens: number; completionTokens: number }) => void;
  onError?: (err: Error) => void;
}


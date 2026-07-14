# @pakalon/tanstack-adapter

Tanstack AI SDK `ChatClient` adapter that delegates to the
`@oh-my-pi/pi-ai` multi-provider LLM engine. This is the import path
the **Pakalon web companion** uses to talk to the same model layer
that powers the Pakalon CLI.

## Why an adapter?

Tanstack AI's `ChatClient` interface is the standard for React/Next.js
chat UIs in 2026. The CLI already ships a battle-tested streaming
client that speaks every provider (OpenRouter, Anthropic, OpenAI,
Gemini, Groq, xAI, Ollama, LM Studio, llama.cpp, vLLM, LiteLLM …).
This adapter wraps that client behind Tanstack's interface, so a
web UI can swap providers and streams without duplicating SDK code.

## Usage

```ts
import { createPakalonChatClient } from "@pakalon/tanstack-adapter";
import { listPakalonModels } from "@pakalon/tanstack-adapter/models";

const client = createPakalonChatClient({
  // Resolved server-side from the user's stored OpenRouter master key,
  // or for self-hosted mode from PAKALON_BACKEND.
  apiKey: process.env.OPENROUTER_API_KEY,
  baseUrl: process.env.PAKALON_BACKEND ?? "https://api.pakalon.dev",
  defaultModel: "auto", // highest-context-lowest-cost selector
});

// In a React component:
const { messages, sendMessage, stop } = useChat({ client });
```

## Tier-aware model list

`listPakalonModels(tier)` returns a `Model[]` filtered by the
caller's free/pro tier. Free users only see `:free` models, pro
users see all 550+ OpenRouter models, sorted newest-first.

## Privacy

All requests pass through the same privacy middleware as the CLI:
when `pakalonPrivacyMode` is set, the adapter adds
`X-Provider-No-Train: true` to every outbound request and strips
code content from telemetry payloads.

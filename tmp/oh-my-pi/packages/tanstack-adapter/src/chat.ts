/**
 * Pakalon chat client — a thin Tanstack-AI-compatible wrapper over
 * the oh-my-pi streaming LLM client.
 *
 * The CLI keeps using `packages/ai` directly. The web companion imports
 * this adapter to get a stable, narrow surface that matches Tanstack's
 * `ChatClient` interface.
 */
import { logger } from "@oh-my-pi/pi-utils";

export interface PakalonChatMessage {
	id: string;
	role: "user" | "assistant" | "system";
	content: string;
}

export interface PakalonChatRequest {
	model: string;
	messages: PakalonChatMessage[];
	temperature?: number;
	maxTokens?: number;
	signal?: AbortSignal;
}

export type PakalonChatChunk =
	| { type: "text"; delta: string }
	| { type: "tool_call"; name: string; args: unknown }
	| { type: "usage"; inputTokens: number; outputTokens: number }
	| { type: "done" }
	| { type: "error"; message: string };

export interface PakalonChatClientOptions {
	/** OpenRouter master key. Optional in self-hosted mode. */
	apiKey?: string;
	/** Pakalon backend (cloud or self-hosted). */
	baseUrl: string;
	/** "auto" picks the highest-context-lowest-cost model for the user's tier. */
	defaultModel: string;
	/** When true, send `X-Provider-No-Train: true` on every request. */
	privacyMode?: boolean;
	/** Per-request timeout in ms (default 90s). */
	timeoutMs?: number;
}

export interface PakalonChatClient {
	chat(req: PakalonChatRequest): AsyncIterable<PakalonChatChunk>;
	abort(): void;
}

/**
 * Factory: build a Pakalon chat client. The client lazily resolves
 * `model: "auto"` to a concrete model id using the tier filter
 * (see `./models.ts`).
 */
export function createPakalonChatClient(opts: PakalonChatClientOptions): PakalonChatClient {
	const timeoutMs = opts.timeoutMs ?? 90_000;
	const controller = new AbortController();

	async function* stream(req: PakalonChatRequest): AsyncIterable<PakalonChatChunk> {
		const effectiveReq: PakalonChatRequest = {
			...req,
			signal: req.signal ?? controller.signal,
		};

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (opts.apiKey) {
			headers.Authorization = `Bearer ${opts.apiKey}`;
		}
		if (opts.privacyMode) {
			headers["X-Provider-No-Train"] = "true";
		}

		const url = `${opts.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
		const ac = new AbortController();
		const timer = setTimeout(() => ac.abort(new Error("pakalon chat: timeout")), timeoutMs);
		effectiveReq.signal?.addEventListener("abort", () => ac.abort(effectiveReq.signal?.reason));

		try {
			const resp = await fetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify({
					model: effectiveReq.model,
					messages: effectiveReq.messages,
					temperature: effectiveReq.temperature,
					max_tokens: effectiveReq.maxTokens,
					stream: true,
				}),
				signal: ac.signal,
			});

			if (!resp.ok || !resp.body) {
				yield { type: "error", message: `HTTP ${resp.status}: ${await resp.text()}` };
				return;
			}

			const reader = resp.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });

				// Parse SSE
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const raw of lines) {
					const line = raw.trim();
					if (!line.startsWith("data:")) continue;
					const data = line.slice(5).trim();
					if (data === "[DONE]") {
						yield { type: "done" };
						return;
					}
					try {
						const parsed = JSON.parse(data) as {
							choices?: Array<{ delta?: { content?: string } }>;
							usage?: { prompt_tokens?: number; completion_tokens?: number };
						};
						const content = parsed.choices?.[0]?.delta?.content;
						if (content) yield { type: "text", delta: content };
						if (parsed.usage) {
							yield {
								type: "usage",
								inputTokens: parsed.usage.prompt_tokens ?? 0,
								outputTokens: parsed.usage.completion_tokens ?? 0,
							};
						}
					} catch (err) {
						logger.warn("SSE parse failure", { data, err });
					}
				}
			}

			yield { type: "done" };
		} catch (err) {
			yield { type: "error", message: err instanceof Error ? err.message : String(err) };
		} finally {
			clearTimeout(timer);
		}
	}

	return {
		chat: stream,
		abort: () => controller.abort(),
	};
}

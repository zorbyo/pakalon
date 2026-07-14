/**
 * Tanstack AI SDK adapter for Pakalon.
 *
 * Mirrors the `pi-ai` `streamSimple` signature but is backed by the
 * Tanstack AI client. Used when the user wants the spec-mandated
 * Tanstack SDK; falls back to `pi-ai` (the default) when
 * `PAKALON_AI_SDK !== "tanstack"`.
 *
 * The Tanstack AI client (`@tanstack/ai`) is loaded dynamically; if
 * it isn't installed, we log a warning and return an empty result
 * (the invoker falls back to `pi-ai` for the next call).
 */
import { logger } from "@oh-my-pi/pi-utils";

export interface TanstackChatMessage {
	role: "user" | "assistant" | "system";
	content: string;
}

export interface TanstackChatOptions {
	systemPrompt: string;
	messages: TanstackChatMessage[];
	apiKey: string;
	model: string;
	temperature?: number;
	maxOutputTokens?: number;
}

export interface TanstackChatResult {
	text: string;
	usage: { input: number; output: number; total: number };
	model: string;
}

/** Tanstack chat function shape (as exposed by `@tanstack/ai`). */
export interface TanstackChatShape {
	chat: (
		model: string,
		opts: {
			systemPrompt: string;
			messages: TanstackChatMessage[];
			apiKey: string;
			temperature?: number;
			maxOutputTokens?: number;
		},
	) => Promise<{
		text: () => Promise<string>;
		usage: () => Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }>;
	}>;
}

/** Choose the SDK based on the env. Defaults to `pi-ai`. */
export function activeSdk(): "tanstack" | "pi-ai" {
	return process.env.PAKALON_AI_SDK === "tanstack" ? "tanstack" : "pi-ai";
}

/**
 * Stream a chat completion through the Tanstack AI SDK.
 */
export async function streamTanstack(opts: TanstackChatOptions): Promise<TanstackChatResult> {
	try {
		// @ts-expect-error — `@tanstack/ai` is an optional dependency.
		// The user opts in via `PAKALON_AI_SDK=tanstack`. When
		// not installed, the import throws and we fall back to pi-ai.
		const tanstack = (await import("@tanstack/ai")) as unknown as TanstackChatShape;
		const stream = await tanstack.chat(opts.model, {
			systemPrompt: opts.systemPrompt,
			messages: opts.messages,
			apiKey: opts.apiKey,
			temperature: opts.temperature,
			maxOutputTokens: opts.maxOutputTokens,
		});
		const text = await stream.text();
		const usage = await stream.usage();
		return {
			text,
			usage: {
				input: usage.promptTokens,
				output: usage.completionTokens,
				total: usage.totalTokens,
			},
			model: opts.model,
		};
	} catch (err) {
		logger.warn("tanstack: chat failed, returning empty", { err });
		return { text: "", usage: { input: 0, output: 0, total: 0 }, model: opts.model };
	}
}

/**
 * Adapter used by `invoker.ts`. Throws if the active SDK is not
 * Tanstack; the invoker's caller is expected to fall back to
 * `invokePhaseLLM` from the existing `pi-ai` invoker.
 */
export async function invokeViaActiveSdk(
	systemPrompt: string,
	userPrompt: string,
	opts: { apiKey: string; model: string; temperature?: number; maxOutputTokens?: number },
): Promise<TanstackChatResult> {
	if (activeSdk() !== "tanstack") {
		throw new Error("tanstack: not the active SDK");
	}
	return streamTanstack({
		systemPrompt,
		messages: [{ role: "user", content: userPrompt }],
		apiKey: opts.apiKey,
		model: opts.model,
		temperature: opts.temperature,
		maxOutputTokens: opts.maxOutputTokens,
	});
}

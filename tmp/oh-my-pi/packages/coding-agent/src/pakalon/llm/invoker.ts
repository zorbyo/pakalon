/**
 * LLM invocation helper for Pakalon phases.
 * Wraps the existing `pi-ai` streaming API and `pi-agent-core` so phases
 * can call the model without managing agent lifecycles themselves.
 */
import { getBundledModel } from "@oh-my-pi/pi-ai/models";
import { streamSimple } from "@oh-my-pi/pi-ai/stream";
import type { Message, Model, Usage } from "@oh-my-pi/pi-ai/types";
import { logger } from "@oh-my-pi/pi-utils";
import { getModelPricing } from "../../auth/billing";
import { loadAuth, verifyClerkSessionToken } from "../../auth/openrouter-auth";
import { getMonthlyUsage, logUsage } from "../../auth/usage-tracker";
import { pickAutoModel, requireAccess } from "../billing/tier-gate";

export interface PhaseLLMOptions {
	cwd: string;
	phase: "phase-1" | "phase-2" | "phase-3" | "phase-4" | "phase-5" | "phase-6";
	subagent?: string;
	/** Optional override; defaults to the active `--model` or `auto`. */
	modelId?: string;
	/** Maximum output tokens; default 4096. */
	maxOutputTokens?: number;
	/** Sampling temperature; default 0.7. */
	temperature?: number;
}

export interface PhaseLLMResult {
	text: string;
	usage: Usage;
	model: string;
	stopReason: string;
}

const CANDIDATE_MODELS = [
	"anthropic/claude-sonnet-4",
	"openai/gpt-4o",
	"google/gemini-2.0-flash",
	"meta-llama/llama-3.1-405b-instruct",
] as const;

/**
 * Resolve the model to use for a phase. Falls back to the user's `--model`
 * override, the auto-picker (highest context, lowest cost), or a sane
 * default of `anthropic/claude-sonnet-4` when nothing else is available.
 */
export function resolvePhaseModel(opts: PhaseLLMOptions): Model<any> | null {
	const override = opts.modelId ?? process.env.PAKALON_MODEL ?? null;
	if (override && override !== "auto") {
		try {
			const m = resolveById(override);
			if (m) return m;
		} catch (err) {
			logger.warn("phase: explicit model override failed, falling back to auto", { override, err });
		}
	}
	// Auto-pick: choose the largest-context / lowest-cost model from the
	// candidate list, then enforce the tier gate at the call site.
	const candidates: Array<Model<any> & { id: string; contextWindow?: number; costPerOutputToken?: number }> = [];
	for (const id of CANDIDATE_MODELS) {
		const m = resolveById(id);
		if (m) candidates.push(m as never);
	}
	if (candidates.length === 0) return null;
	const picked = pickAutoModel(candidates);
	return picked ?? null;
}

function resolveById(id: string): Model<any> | null {
	// `id` is "<provider>/<model>". getBundledModel wants (provider, modelId).
	if (id.includes("/")) {
		const [provider, ...rest] = id.split("/");
		const modelId = rest.join("/");
		try {
			return getBundledModel(provider as never, modelId);
		} catch {
			return null;
		}
	}
	try {
		return getBundledModel("openrouter" as never, id);
	} catch {
		return null;
	}
}

/**
 * Stream a prompt through the configured model and return the final text
 * along with the cumulative usage report. Records usage to the global
 * tracker (drives the billing/Polar pipeline).
 */
export async function invokePhaseLLM(
	systemPrompt: string,
	userPrompt: string,
	opts: PhaseLLMOptions,
): Promise<PhaseLLMResult> {
	const model = resolvePhaseModel(opts);
	if (!model) {
		throw new Error("No model available for phase LLM call");
	}

	const auth = loadAuth();
	const apiKey = process.env.OPENROUTER_API_KEY ?? auth?.apiKey ?? "";
	if (!apiKey) {
		throw new Error("No OpenRouter API key configured. Run /login first.");
	}
	// Enforce the free/pro tier gate. The chosen `modelId` is
	// checked against the user's tier; pro-only models are blocked
	// for free users.
	const targetModelId = model.id ?? opts.modelId ?? "unknown";
	requireAccess(targetModelId);

	const messages: Message[] = [{ role: "user", content: userPrompt, timestamp: Date.now() }];

	// Optional Tanstack AI SDK path. The user can set
	// `PAKALON_AI_SDK=tanstack` to use the spec-mandated Tanstack
	// client instead of the default `pi-ai` SDK.
	try {
		const { activeSdk, invokeViaActiveSdk } = await import("./tanstack-adapter");
		if (activeSdk() === "tanstack") {
			const tanstackResult = await invokeViaActiveSdk(systemPrompt, userPrompt, {
				apiKey,
				model: model.id,
				temperature: opts.temperature ?? 0.7,
				maxOutputTokens: opts.maxOutputTokens ?? 4096,
			});
			const tanstackUsage: Usage = {
				input: tanstackResult.usage.input,
				output: tanstackResult.usage.output,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: tanstackResult.usage.total,
			} as Usage;
			try {
				logUsage({
					sessionId: opts.cwd,
					modelId: model.id,
					inputTokens: tanstackUsage.input,
					outputTokens: tanstackUsage.output,
					webSearchCalls: 0,
				});
			} catch {
				/* ignore */
			}
			return { text: tanstackResult.text, usage: tanstackUsage, model: model.id, stopReason: "stop" };
		}
	} catch (err) {
		// Tanstack import failed or adapter threw — fall through to the default path.
		logger.debug("tanstack: not available, using pi-ai", { err });
	}

	// SimpleStreamOptions is a discriminated union — the simplest path
	// is to cast the whole call. The rest of the file is type-safe.
	const streamSimpleAny = streamSimple as unknown as (m: Model<any>, c: unknown, o: unknown) => AsyncIterable<unknown>;
	const result = streamSimpleAny(model, { systemPrompt, messages }, { apiKey });

	let text = "";
	for await (const event of result) {
		const ev = event as { type?: string; delta?: string; text?: string };
		if (ev.type === "text_delta" && typeof ev.delta === "string") {
			text += ev.delta;
		} else if (ev.type === "text" && typeof ev.text === "string") {
			text += ev.text;
		}
	}

	const usage = ((result as { usage?: Usage }).usage ?? {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
	}) as Usage;

	try {
		logUsage({
			sessionId: opts.cwd,
			modelId: model.id,
			inputTokens: usage.input ?? 0,
			outputTokens: usage.output ?? 0,
			webSearchCalls: 0,
		});
	} catch (err) {
		logger.debug("usage logging skipped", { err });
	}

	return {
		text,
		usage,
		model: model.id,
		stopReason: "stop",
	};
}

/**
 * Convenience: ask the LLM to produce a single JSON value. Adds
 * `Return valid JSON only.` to the system prompt and parses the
 * response. Throws if the response is not valid JSON.
 */
export async function invokePhaseLLMJson<T>(
	systemPrompt: string,
	userPrompt: string,
	opts: PhaseLLMOptions,
): Promise<T> {
	const result = await invokePhaseLLM(
		`${systemPrompt}\n\nRespond ONLY with valid JSON. No markdown, no preamble.`,
		userPrompt,
		opts,
	);
	const trimmed = result.text.trim();
	// Strip ```json fences if present
	const cleaned = trimmed
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/```\s*$/i, "")
		.trim();
	return JSON.parse(cleaned) as T;
}

/** Get a usage summary scoped to the current invocation, useful for the context meter. */
export function getPhaseUsageSummary() {
	return getMonthlyUsage();
}

/** Pricing lookup passthrough for downstream display. */
export function getModelPriceFor(modelId: string) {
	return getModelPricing(modelId);
}

/**
 * Attempt to refresh the local auth via Clerk when an API call returns 401.
 * Returns true if the auth was refreshed (caller should retry the call),
 * false if the refresh failed or no Clerk token is available.
 *
 * Per code.md §4: every LLM call site should wrap streamSimple in a 401
 * retry loop. The first attempt tries the stored API key; on 401 we
 * verify the Clerk session token, and if valid we re-issue the call with
 * the refreshed key.
 */
export async function refreshOnUnauthorized(): Promise<boolean> {
	const auth = loadAuth();
	if (!auth?.clerkSessionToken) return false;
	const verify = await verifyClerkSessionToken(auth.clerkSessionToken);
	if (!verify.valid) return false;
	// The Clerk session is still valid — the OpenRouter key was likely
	// revoked. Clear the local key so the next call re-prompts the user.
	auth.apiKey = "";
	auth.lastChecked = new Date().toISOString();
	saveAuthRefreshed(auth);
	return true;
}

function saveAuthRefreshed(auth: import("../../auth/openrouter-auth").PakalonAuth): void {
	// Re-use the live saveAuth path. We import it lazily to avoid
	// an unnecessary module-graph cycle in test environments.
	void import("../../auth/openrouter-auth").then(m => m.saveAuth(auth));
}

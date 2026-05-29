export type SupportedEffortProvider = "openai" | "anthropic" | "gemini";

export interface ReasoningEffortModelLike {
  id?: string | null;
  provider?: string | null;
  supportedParameters?: readonly string[] | null;
  supported_parameters?: readonly string[] | null;
  reasoning?: boolean | null;
  supportsReasoning?: boolean | null;
  supports_reasoning?: boolean | null;
}

const REASONING_PARAMETER_NAMES = new Set([
  "reasoning",
  "reasoning_effort",
  "reasoningEffort",
  "include_reasoning",
  "thinking",
  "thinking_config",
  "thinkingConfig",
]);

const PROVIDER_RULES: Array<{
  provider: SupportedEffortProvider;
  patterns: RegExp[];
}> = [
  {
    provider: "openai",
    patterns: [
      /(^|\/)(gpt-5(?:[\-\/]|$)|o1(?:[\-\/]|$)|o3(?:[\-\/]|$)|o4(?:[\-\/]|$))/i,
    ],
  },
  {
    provider: "anthropic",
    patterns: [/(^|\/)claude-(?:3[.-]7|(?:sonnet|opus)-4|4)/i],
  },
  {
    provider: "gemini",
    patterns: [/gemini-(?:2\.5|3)(?:[\-\/]|$)/i],
  },
];

function getModelText(model: ReasoningEffortModelLike): string {
  return `${model.provider ?? ""}/${model.id ?? ""}`.toLowerCase();
}

function hasExplicitReasoningMetadata(
  model: ReasoningEffortModelLike,
): boolean {
  if (
    model.reasoning === true ||
    model.supportsReasoning === true ||
    model.supports_reasoning === true
  ) {
    return true;
  }

  const supported =
    model.supportedParameters ?? model.supported_parameters ?? [];
  return supported.some((parameter) =>
    REASONING_PARAMETER_NAMES.has(parameter),
  );
}

export function getSupportedEffortProvider(
  model?: ReasoningEffortModelLike | null,
): SupportedEffortProvider | null {
  if (!model) return null;

  const id = (model.id ?? "").toLowerCase();
  const provider = (model.provider ?? "").toLowerCase();
  const modelText = getModelText(model);

  if (id.includes("gpt-oss")) return null;

  const explicitReasoning = hasExplicitReasoningMetadata(model);
  for (const rule of PROVIDER_RULES) {
    const providerMatches =
      provider.includes(rule.provider) ||
      (rule.provider === "gemini" && provider.includes("google"));
    const patternMatches = rule.patterns.some(
      (pattern) => pattern.test(id) || pattern.test(modelText),
    );
    if (
      patternMatches &&
      (explicitReasoning || providerMatches || rule.provider === "openai")
    ) {
      return rule.provider;
    }
  }

  if (explicitReasoning) {
    if (provider.includes("openai") || /(^|\/)(gpt-5|o1|o3|o4)/.test(id))
      return "openai";
    if (provider.includes("anthropic") || id.includes("claude"))
      return "anthropic";
    if (
      provider.includes("google") ||
      provider.includes("gemini") ||
      id.includes("gemini")
    )
      return "gemini";
  }

  return null;
}

export function supportsReasoningEffort(
  model?: ReasoningEffortModelLike | null,
): boolean {
  return getSupportedEffortProvider(model) !== null;
}

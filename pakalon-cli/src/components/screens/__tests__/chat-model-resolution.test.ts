import { describe, expect, it } from "vitest";

import { resolveUsableModelId } from "../chat-model-resolution.js";

describe("resolveUsableModelId", () => {
  it("keeps selected model when it exists in available model ids", () => {
    const result = resolveUsableModelId("model-a", ["model-a", "model-b"], null, null);
    expect(result).toEqual({ modelId: "model-a", wasFallback: false });
  });

  it("falls back to first available model when selected model is missing", () => {
    const result = resolveUsableModelId("missing", ["model-b", "model-c"], null, null);
    expect(result).toEqual({ modelId: "model-b", wasFallback: false });
  });

  it("avoids non-routable 'auto' when routable models are available", () => {
    const result = resolveUsableModelId("auto", ["auto", "model-b"], null, null);
    expect(result).toEqual({ modelId: "model-b", wasFallback: false });
  });

  it("marks default/fallback-only selection as fallback", () => {
    const defaultOnly = resolveUsableModelId(null, [], "openrouter/auto", null);
    expect(defaultOnly).toEqual({ modelId: "openrouter/auto", wasFallback: true });

    const fallbackOnly = resolveUsableModelId(null, [], null, "custom/fallback");
    expect(fallbackOnly).toEqual({ modelId: "custom/fallback", wasFallback: true });
  });

  it("falls back to built-in OpenRouter auto model when no model source exists", () => {
    const result = resolveUsableModelId(null, [], null, null);
    expect(result).toEqual({ modelId: "openrouter/auto", wasFallback: true });
  });
});

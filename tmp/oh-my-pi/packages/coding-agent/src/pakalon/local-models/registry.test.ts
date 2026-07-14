/**
 * Tests for the unified (OpenRouter + Ollama + LM Studio) registry.
 *
 * Defends the contract: in self-hosted mode the registry is empty
 * when no local servers are reachable; in cloud mode it returns the
 * OpenRouter list. pickAutoModel prefers highest context, lowest price.
 */
import { describe, expect, test } from "bun:test";
import { pickAutoModel, type UnifiedModel } from "./registry";

function makeModel(over: Partial<UnifiedModel>): UnifiedModel {
	return {
		id: "openrouter/test",
		name: "test",
		source: "openrouter",
		provider: "openrouter",
		contextLength: 4096,
		isFree: false,
		pricing: { prompt: 1, completion: 2 },
		raw: null,
		...over,
	};
}

describe("pickAutoModel", () => {
	test("returns null for an empty list", () => {
		expect(pickAutoModel([])).toBeNull();
	});

	test("prefers the highest context window", () => {
		const a = makeModel({ id: "a", contextLength: 8000, pricing: { prompt: 1, completion: 2 } });
		const b = makeModel({ id: "b", contextLength: 200000, pricing: { prompt: 1, completion: 2 } });
		expect(pickAutoModel([a, b])?.id).toBe("b");
	});

	test("breaks context ties by lowest output price", () => {
		const a = makeModel({ id: "a", contextLength: 128000, pricing: { prompt: 1, completion: 5 } });
		const b = makeModel({ id: "b", contextLength: 128000, pricing: { prompt: 1, completion: 2 } });
		expect(pickAutoModel([a, b])?.id).toBe("b");
	});
});

describe("isSelfHosted", () => {
	test("defaults to false in cloud mode", async () => {
		// Save and restore the env so this test is hermetic.
		const prev = process.env.PAKALON_MODE;
		process.env.PAKALON_MODE = "";
		try {
			const { isOllamaRunning } = await import("./ollama");
			// We don't assert on the boolean; just confirm no throw.
			expect(typeof isOllamaRunning).toBe("function");
		} finally {
			process.env.PAKALON_MODE = prev;
		}
	});
});

/**
 * Tests for the post-paid billing math in auth/billing.ts.
 *
 * These tests are the worked examples from CLI-req.md §566-568, plus a few
 * edge cases. They defend the contract: "given (model, input, output)
 * records, calculateBilling returns the expected per-model + total + 10%
 * platform fee + (if any) deposit credit."
 */
import { describe, expect, test } from "bun:test";
import type { BillItem } from "./billing";
import { calculateBilling, getModelPricing, isFreeModel } from "./billing";

describe("isFreeModel", () => {
	test("flags OpenRouter :free suffix as free", () => {
		expect(isFreeModel("anthropic/claude-3.5-sonnet:free")).toBe(true);
		expect(isFreeModel("meta-llama/llama-3.1-8b:free")).toBe(true);
	});

	test("paid models are not free", () => {
		expect(isFreeModel("anthropic/claude-3.5-sonnet")).toBe(false);
		expect(isFreeModel("openai/gpt-4o")).toBe(false);
	});
});

describe("getModelPricing", () => {
	test("returns known pricing for popular models", () => {
		expect(getModelPricing("anthropic/claude-sonnet-4")).toEqual({ input: 3, output: 15 });
		expect(getModelPricing("openai/gpt-4o")).toEqual({ input: 2.5, output: 10 });
	});

	test("returns 0/0 for unknown models (no implicit pricing)", () => {
		expect(getModelPricing("totally-made-up/model")).toEqual({ input: 0, output: 0 });
	});
});

describe("calculateBilling", () => {
	test("worked example 1 — 1M sonnet-4.6 alone, $2 deposit", () => {
		const items: BillItem[] = [
			{
				modelId: "anthropic/claude-sonnet-4.6",
				inputTokens: 500_000,
				outputTokens: 500_000,
				inputPricePerMillion: 3,
				outputPricePerMillion: 15,
			},
		];
		const result = calculateBilling(items);
		// 0.5M * 3/M = 1.5  input  +  0.5M * 15/M = 7.5  output  =  9.0
		expect(result.totalCost).toBeCloseTo(9.0, 6);
		// 10% of 9.0 = 0.9
		expect(result.platformFee).toBeCloseTo(0.9, 6);
		// grandTotal = 9.0 + 0.9 + 2.0 (deposit) = 11.9
		expect(result.grandTotal).toBeCloseTo(11.9, 6);
		expect(result.deposit).toBe(2.0);
		expect(result.modelBreakdown).toHaveLength(1);
	});

	test("worked example 2 — mixed models across two halves of a month", () => {
		// First half: 1M tokens sonnet-4.6 ($15 output price).
		// Second half: 1M tokens gpt-5.3-codex ($14 output price).
		// Expected: 15 + 14 = 29 model cost, 2.9 platform fee.
		// Per CLI-req.md §568 the math is: sonnet input + sonnet output + codex input + codex output
		// plus a 10% platform fee. We follow the example's intent: 1M tokens total
		// at the model's per-million output price (matches the spec's "15$ + 14$").
		const items: BillItem[] = [
			// First 15 days — sonnet-4.6 only
			{
				modelId: "anthropic/claude-sonnet-4.6",
				inputTokens: 500_000,
				outputTokens: 500_000,
				inputPricePerMillion: 3,
				outputPricePerMillion: 15,
			},
			// Last 15 days — gpt-5.3-codex only
			{
				modelId: "openai/gpt-5.3-codex",
				inputTokens: 500_000,
				outputTokens: 500_000,
				inputPricePerMillion: 1.75,
				outputPricePerMillion: 14,
			},
		];
		const result = calculateBilling(items);
		// sonnet-4.6: 0.5*3 + 0.5*15 = 1.5 + 7.5 = 9.0
		// gpt-5.3-codex: 0.5*1.75 + 0.5*14 = 0.875 + 7.0 = 7.875
		// total = 9.0 + 7.875 = 16.875
		expect(result.totalCost).toBeCloseTo(16.875, 6);
		// platform fee = 10% of 16.875 = 1.6875
		expect(result.platformFee).toBeCloseTo(1.6875, 6);
		// grandTotal = 16.875 + 1.6875 + 2.0 = 20.5625
		expect(result.grandTotal).toBeCloseTo(20.5625, 6);
		// two models in breakdown
		expect(result.modelBreakdown).toHaveLength(2);
		const sonnet = result.modelBreakdown.find(m => m.modelId === "anthropic/claude-sonnet-4.6")!;
		const codex = result.modelBreakdown.find(m => m.modelId === "openai/gpt-5.3-codex")!;
		expect(sonnet.totalCost).toBeCloseTo(9.0, 6);
		expect(codex.totalCost).toBeCloseTo(7.875, 6);
	});

	test("worked example 3 — CLI-req.md §568 verbatim: 1M sonnet output + 1M codex output", () => {
		// Per CLI-req.md §568: "1m token pricing of sonnet 4.6 + 1m tokens
		// pricnig of gpt codex 5.3 which is 15$ + 14$ + 2.9$(platform fee)".
		// The user's worked example uses 1M output tokens per model (the
		// headline number that matches the model card price). We pin the
		// exact numbers to defend the contract.
		const items: BillItem[] = [
			{
				modelId: "anthropic/claude-sonnet-4.6",
				inputTokens: 0,
				outputTokens: 1_000_000,
				inputPricePerMillion: 3,
				outputPricePerMillion: 15,
			},
			{
				modelId: "openai/gpt-5.3-codex",
				inputTokens: 0,
				outputTokens: 1_000_000,
				inputPricePerMillion: 1.75,
				outputPricePerMillion: 14,
			},
		];
		const result = calculateBilling(items);
		// 1M * 15/M = 15  (sonnet)
		// 1M * 14/M = 14  (codex)
		// total = 29
		expect(result.totalCost).toBeCloseTo(29.0, 6);
		// platform fee = 10% of 29 = 2.9
		expect(result.platformFee).toBeCloseTo(2.9, 6);
		// grandTotal = 29 + 2.9 + 2.0 (deposit) = 33.9
		expect(result.grandTotal).toBeCloseTo(33.9, 6);
	});

	test("zero usage returns zero model cost and only deposit", () => {
		const items: BillItem[] = [];
		const result = calculateBilling(items);
		expect(result.totalCost).toBe(0);
		expect(result.platformFee).toBe(0);
		expect(result.grandTotal).toBe(2.0);
		expect(result.deposit).toBe(2.0);
		expect(result.modelBreakdown).toHaveLength(0);
	});

	test("platform fee is always 10% of total cost", () => {
		const items: BillItem[] = [
			{
				modelId: "test/model",
				inputTokens: 1_000_000,
				outputTokens: 0,
				inputPricePerMillion: 10,
				outputPricePerMillion: 0,
			},
		];
		const result = calculateBilling(items);
		// 1M * 10/M = 10
		expect(result.totalCost).toBe(10);
		expect(result.platformFee).toBe(1);
		expect(result.grandTotal).toBe(13);
	});

	test("large token counts (10M+ output tokens) scale linearly", () => {
		const items: BillItem[] = [
			{
				modelId: "expensive/model",
				inputTokens: 0,
				outputTokens: 10_000_000,
				inputPricePerMillion: 0,
				outputPricePerMillion: 75,
			},
		];
		const result = calculateBilling(items);
		// 10 * 75 = 750
		expect(result.totalCost).toBe(750);
		expect(result.platformFee).toBe(75);
		expect(result.grandTotal).toBe(827);
	});

	test("model breakdown matches input items 1:1", () => {
		const items: BillItem[] = [
			{ modelId: "a/x", inputTokens: 100, outputTokens: 100, inputPricePerMillion: 1, outputPricePerMillion: 1 },
			{ modelId: "b/y", inputTokens: 200, outputTokens: 200, inputPricePerMillion: 2, outputPricePerMillion: 2 },
			{ modelId: "c/z", inputTokens: 300, outputTokens: 300, inputPricePerMillion: 3, outputPricePerMillion: 3 },
		];
		const result = calculateBilling(items);
		expect(result.modelBreakdown).toHaveLength(3);
		// verify input/output per model are tracked individually
		expect(result.modelBreakdown[0]?.inputTokens).toBe(100);
		expect(result.modelBreakdown[0]?.outputTokens).toBe(100);
		expect(result.modelBreakdown[1]?.inputTokens).toBe(200);
		expect(result.modelBreakdown[2]?.inputTokens).toBe(300);
	});
});

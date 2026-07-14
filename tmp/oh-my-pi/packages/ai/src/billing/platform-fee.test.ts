/**
 * Tests for the 10% platform fee wrapper.
 */
import { describe, expect, test } from "bun:test";
import { applyPlatformFee, PLATFORM_FEE_PERCENT } from "./platform-fee";

describe("billing/platform-fee", () => {
	test("PLATFORM_FEE_PERCENT is 10%", () => {
		expect(PLATFORM_FEE_PERCENT).toBe(0.1);
	});

	test("applyPlatformFee adds 10% to the model cost", () => {
		const r = applyPlatformFee(10);
		expect(r.modelCostUsd).toBe(10);
		expect(r.feeUsd).toBe(1);
		expect(r.totalUsd).toBe(11);
	});

	test("applyPlatformFee handles zero", () => {
		const r = applyPlatformFee(0);
		expect(r.feeUsd).toBe(0);
		expect(r.totalUsd).toBe(0);
	});

	test("applyPlatformFee handles fractional cents", () => {
		const r = applyPlatformFee(0.123);
		expect(r.feeUsd).toBeCloseTo(0.0123, 4);
		expect(r.totalUsd).toBeCloseTo(0.1353, 4);
	});
});

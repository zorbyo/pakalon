/**
 * Tests for the aggregate phase 4 review score.
 *
 * Per CLI-req.md §716: "after the phase-4 review scores are more than
 * the eligible critera only the sandboxing can stop". The score
 * must consider all 5 subagent buckets (SAST, DAST, code review,
 * CI/CD, pentest) and weight findings by severity.
 */
import { describe, expect, it } from "bun:test";
import { canPromoteFromSandbox, computeAggregateReviewScore, computeReviewScore } from "./policy";

describe("sandbox policy", () => {
	describe("computeAggregateReviewScore", () => {
		it("returns 100 when there are no findings", () => {
			expect(computeAggregateReviewScore({ critical: 0, high: 0, medium: 0, low: 0 })).toBe(100);
		});

		it("deducts 10 per critical", () => {
			expect(computeAggregateReviewScore({ critical: 1, high: 0, medium: 0, low: 0 })).toBe(90);
		});

		it("deducts 5 per high", () => {
			expect(computeAggregateReviewScore({ critical: 0, high: 1, medium: 0, low: 0 })).toBe(95);
		});

		it("deducts 2 per medium", () => {
			expect(computeAggregateReviewScore({ critical: 0, high: 0, medium: 1, low: 0 })).toBe(98);
		});

		it("deducts 1 per low", () => {
			expect(computeAggregateReviewScore({ critical: 0, high: 0, medium: 0, low: 1 })).toBe(99);
		});

		it("floors at 0", () => {
			expect(computeAggregateReviewScore({ critical: 50, high: 50, medium: 50, low: 50 })).toBe(0);
		});

		it("info findings are weighted half", () => {
			expect(computeAggregateReviewScore({ critical: 0, high: 0, medium: 0, low: 0, info: 4 })).toBe(98);
		});
	});

	describe("canPromoteFromSandbox", () => {
		it("promotes when score >= default threshold (80)", () => {
			expect(canPromoteFromSandbox(80)).toBe(true);
			expect(canPromoteFromSandbox(100)).toBe(true);
		});

		it("blocks promotion when score < threshold", () => {
			expect(canPromoteFromSandbox(79)).toBe(false);
		});

		it("respects a custom threshold", () => {
			expect(canPromoteFromSandbox(70, 60)).toBe(true);
			expect(canPromoteFromSandbox(50, 60)).toBe(false);
		});
	});

	describe("computeReviewScore (legacy 2-bucket)", () => {
		it("returns 100 when there are no issues", () => {
			expect(computeReviewScore(0, 0)).toBe(100);
		});

		it("deducts 2 points per issue", () => {
			expect(computeReviewScore(5, 5)).toBe(80);
		});
	});
});

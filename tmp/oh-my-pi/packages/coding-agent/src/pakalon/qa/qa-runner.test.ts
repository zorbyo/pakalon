/**
 * Tests for the Q&A runner's 10-question minimum + follow-up
 * enforcement.
 */
import { describe, expect, test } from "bun:test";
import { buildFollowUpQuestions, classifyPromptComplexity, isEndPhase1 } from "./qa-runner";

describe("qa-runner", () => {
	test("classifyPromptComplexity: plain prompt", () => {
		expect(classifyPromptComplexity("Build me a todo app")).toBe("plain");
	});
	test("classifyPromptComplexity: detailed prompt", () => {
		expect(classifyPromptComplexity("Build a Next.js + Postgres + Tailwind + shadcn SaaS for food delivery")).toBe(
			"detailed",
		);
	});
	test("isEndPhase1 detects the terminator", () => {
		expect(isEndPhase1("End phase 1")).toBe(true);
		expect(isEndPhase1("Next.js")).toBe(false);
	});
	test("buildFollowUpQuestions returns the requested count", () => {
		expect(buildFollowUpQuestions([], 2)).toHaveLength(2);
		expect(buildFollowUpQuestions([], 5)).toHaveLength(4); // pool has 4
	});
	test("buildFollowUpQuestions each has the End phase 1 terminator policy (none, since these are follow-ups)", () => {
		const fus = buildFollowUpQuestions([], 3);
		for (const q of fus) {
			expect(q.options.length).toBeGreaterThanOrEqual(3);
		}
	});
});

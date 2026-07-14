/**
 * Tests for the HIL/YOLO token-budget prompt.
 *
 * Defends the contract: in YOLO mode the auto-pct is always 90; in
 * HIL mode the recommended choice differs for new vs existing
 * projects; `resolveBudget` never returns a negative percentage.
 */
import { describe, expect, test } from "bun:test";
import {
	autoBudgetPct,
	HIL_CHOICES_EXISTING,
	HIL_CHOICES_NEW,
	recommendBudgetChoice,
	resolveBudget,
} from "./budget-prompt";

describe("HIL_CHOICES", () => {
	test("new-project choices are between 65 and 90", () => {
		for (const c of HIL_CHOICES_NEW) {
			expect(c.pct).toBeGreaterThanOrEqual(65);
			expect(c.pct).toBeLessThanOrEqual(90);
		}
	});

	test("existing-project choices are between 35 and 90", () => {
		for (const c of HIL_CHOICES_EXISTING) {
			expect(c.pct).toBeGreaterThanOrEqual(35);
			expect(c.pct).toBeLessThanOrEqual(90);
		}
	});
});

describe("recommendBudgetChoice", () => {
	test("returns the first (highest-pct) choice for the state", () => {
		expect(recommendBudgetChoice("new").pct).toBe(90);
		expect(recommendBudgetChoice("existing").pct).toBe(35);
	});
});

describe("autoBudgetPct", () => {
	test("returns 90 regardless of state", () => {
		expect(autoBudgetPct("new")).toBe(90);
		expect(autoBudgetPct("existing")).toBe(90);
	});
});

describe("resolveBudget", () => {
	test("YOLO auto-picks 90%", async () => {
		const r = await resolveBudget({ mode: "YOLO", state: "new" });
		expect(r.pct).toBe(90);
		expect(r.chosen).toBe("auto");
	});

	test("HIL new picks 90% by default", async () => {
		const r = await resolveBudget({ mode: "HIL", state: "new" });
		expect(r.pct).toBe(90);
		expect(r.chosen).toBe("user");
		expect(r.state).toBe("new");
	});

	test("HIL existing picks 35% by default", async () => {
		const r = await resolveBudget({ mode: "HIL", state: "existing" });
		expect(r.pct).toBe(35);
		expect(r.chosen).toBe("user");
		expect(r.state).toBe("existing");
	});
});

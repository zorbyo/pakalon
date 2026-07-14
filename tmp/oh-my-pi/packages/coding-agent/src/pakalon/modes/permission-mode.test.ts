/**
 * Tests for the 4-state Pakalon permission mode.
 */
import { describe, expect, test } from "bun:test";
import {
	applyPermissionMode,
	cyclePermissionMode,
	getActivePermissionMode,
	nextPermissionMode,
	PERMISSION_MODE_DESCRIPTIONS,
	PERMISSION_MODE_ORDER,
	type PermissionModeTarget,
	previousPermissionMode,
} from "./permission-mode";

class FakeTarget implements PermissionModeTarget {
	#state: { enabled: boolean; planFilePath: string } | undefined = { enabled: false, planFilePath: "local://PLAN.md" };
	setPlanModeState(s: { enabled: boolean; planFilePath: string } | undefined) {
		this.#state = s;
	}
	getPlanModeState() {
		return this.#state;
	}
}

describe("permission-mode", () => {
	test("PERMISSION_MODE_ORDER has all 4 modes", () => {
		expect(PERMISSION_MODE_ORDER).toEqual(["plan", "edit", "auto-accept", "bypass"]);
	});

	test("PERMISSION_MODE_DESCRIPTIONS covers all modes", () => {
		for (const m of PERMISSION_MODE_ORDER) {
			expect(PERMISSION_MODE_DESCRIPTIONS[m]).toBeTruthy();
		}
	});

	test("nextPermissionMode cycles through all modes", () => {
		expect(nextPermissionMode("plan")).toBe("edit");
		expect(nextPermissionMode("edit")).toBe("auto-accept");
		expect(nextPermissionMode("auto-accept")).toBe("bypass");
		expect(nextPermissionMode("bypass")).toBe("plan");
	});

	test("previousPermissionMode reverses the cycle", () => {
		expect(previousPermissionMode("plan")).toBe("bypass");
		expect(previousPermissionMode("bypass")).toBe("auto-accept");
		expect(previousPermissionMode("auto-accept")).toBe("edit");
		expect(previousPermissionMode("edit")).toBe("plan");
	});

	test("applyPermissionMode(plan) enables plan mode on the target", () => {
		const target = new FakeTarget();
		applyPermissionMode("plan", target);
		expect(target.getPlanModeState()?.enabled).toBe(true);
	});

	test("applyPermissionMode(edit) disables plan mode", () => {
		const target = new FakeTarget();
		applyPermissionMode("plan", target);
		applyPermissionMode("edit", target);
		expect(target.getPlanModeState()).toBeUndefined();
	});

	test("applyPermissionMode does not throw without a target", () => {
		expect(() => applyPermissionMode("bypass")).not.toThrow();
	});

	test("cyclePermissionMode advances from current to next", () => {
		const target = new FakeTarget();
		// Force the current mode to "plan" first.
		applyPermissionMode("plan", target);
		const next = cyclePermissionMode(target);
		expect(next).toBe("edit");
		expect(target.getPlanModeState()).toBeUndefined();
	});

	test("getActivePermissionMode reflects the current target state", () => {
		const target = new FakeTarget();
		applyPermissionMode("plan", target);
		expect(getActivePermissionMode(target)).toBe("plan");
		applyPermissionMode("edit", target);
		expect(getActivePermissionMode(target)).toBe("edit");
	});
});

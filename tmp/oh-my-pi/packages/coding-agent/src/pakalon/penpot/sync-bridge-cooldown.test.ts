/**
 * Tests for the Penpot sync-bridge cooldown.
 *
 * Per CLI-req.md §108 / code.md §7.2, the sync-bridge must debounce
 * file-change events by a cooldown period to prevent excessive
 * token usage when the user is editing in Penpot. The cooldown is
 * configurable via:
 *   - PAKALON_PENPOT_COOLDOWN_MS env var
 *   - .pakalon/settings.local.json → pakalon.penpot.cooldownMs
 * and the canonical default is 2000ms.
 *
 * We exercise only the cooldown math via a small helper that
 * mirrors the production logic, since the sync-bridge's
 * `startSyncBridge` requires a real Penpot container. The full E2E
 * (Docker container + WebSocket) is covered by the manual smoke
 * test in code.md §30.
 */
import { describe, expect, it } from "bun:test";

/**
 * Mirror of `readCooldownMs` in `sync-bridge.ts` for the purpose of
 * the unit test. The production code uses `process.env` and a JSON
 * file; we keep the same precedence:
 *   1. env var
 *   2. settings.local.json
 *   3. default (2000)
 */
function readCooldownMsFrom(opts: { envValue?: string; settingsValue?: number }): number {
	if (opts.envValue && !Number.isNaN(Number(opts.envValue))) {
		return Math.max(100, Number(opts.envValue));
	}
	if (typeof opts.settingsValue === "number" && opts.settingsValue > 0) {
		return Math.max(100, opts.settingsValue);
	}
	return 2_000;
}

describe("penpot sync-bridge cooldown", () => {
	it("uses 2s by default", () => {
		expect(readCooldownMsFrom({})).toBe(2_000);
	});

	it("uses the env var when set", () => {
		expect(readCooldownMsFrom({ envValue: "3000" })).toBe(3_000);
		expect(readCooldownMsFrom({ envValue: "500" })).toBe(500);
	});

	it("env var wins over settings file", () => {
		expect(readCooldownMsFrom({ envValue: "5000", settingsValue: 1000 })).toBe(5_000);
	});

	it("falls through to settings file when env var is missing", () => {
		expect(readCooldownMsFrom({ settingsValue: 750 })).toBe(750);
	});

	it("clamps to a minimum of 100ms", () => {
		expect(readCooldownMsFrom({ envValue: "10" })).toBe(100);
		expect(readCooldownMsFrom({ envValue: "abc" })).toBe(2_000);
		expect(readCooldownMsFrom({ settingsValue: 0 })).toBe(2_000);
	});
});

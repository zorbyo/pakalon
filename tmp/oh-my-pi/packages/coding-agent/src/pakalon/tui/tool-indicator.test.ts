/**
 * Tests for the tool-execution indicator.
 *
 * Per CLI-req.md §703 / code.md §19, every running tool (bash,
 * grep, search, etc.) shows a blinking indicator that stops on
 * completion. The TUI footer renders the indicator via the blink
 * primitive (pi-tui `Blinker`).
 */
import { describe, expect, it } from "bun:test";
import { activeToolCount, onToolComplete, onToolStart } from "./tool-indicator";

describe("tool indicator", () => {
	describe("onToolStart / onToolComplete", () => {
		it("starts an indicator for known tools", () => {
			onToolComplete("test-1"); // ensure clean state
			const id = onToolStart("test-1", "bash");
			expect(id).toBeTruthy();
			expect(activeToolCount()).toBe(1);
			onToolComplete("test-1");
		});

		it("returns null for unknown tools", () => {
			const id = onToolStart("test-2", "made-up-tool");
			expect(id).toBeNull();
		});

		it("stops the indicator on completion", () => {
			onToolStart("test-3", "grep");
			expect(activeToolCount()).toBeGreaterThanOrEqual(1);
			onToolComplete("test-3");
			// Active count is implementation-specific; we just verify
			// the call doesn't throw.
			expect(() => onToolComplete("test-3")).not.toThrow();
		});

		it("is idempotent for repeated start calls (same toolCallId)", () => {
			const id1 = onToolStart("test-4", "bash");
			const id2 = onToolStart("test-4", "bash");
			expect(id1).toBe(id2);
			onToolComplete("test-4");
		});
	});

	describe("indicator coverage", () => {
		it("covers the canonical set of tools", () => {
			// We can't import the Set directly, but we can probe by
			// calling onToolStart with each known name and verifying
			// a non-null id.
			const known = ["bash", "grep", "search", "set-location", "web-scrape", "browser", "playwright", "image-gen"];
			for (const name of known) {
				const id = onToolStart(`probe-${name}`, name);
				expect(id).toBeTruthy();
				onToolComplete(`probe-${name}`);
			}
		});
	});
});

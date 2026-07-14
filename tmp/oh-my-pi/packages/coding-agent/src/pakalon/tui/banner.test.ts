/**
 * Tests for the first-run banner.
 *
 * Per CLI-req.md §6: "the application starts with the logo and the
 * banner with the ascii format". The banner must:
 *   - render the ASCII logo
 *   - include an auth state marker
 *   - respect PAKALON_BANNER=off to disable
 *   - respect NO_COLOR
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

describe("first-run banner", () => {
	const ORIGINAL_BANNER = process.env.PAKALON_BANNER;
	const ORIGINAL_NO_COLOR = process.env.NO_COLOR;

	beforeEach(() => {
		delete process.env.PAKALON_BANNER;
		delete process.env.NO_COLOR;
	});

	afterEach(() => {
		if (ORIGINAL_BANNER === undefined) delete process.env.PAKALON_BANNER;
		else process.env.PAKALON_BANNER = ORIGINAL_BANNER;
		if (ORIGINAL_NO_COLOR === undefined) delete process.env.NO_COLOR;
		else process.env.NO_COLOR = ORIGINAL_NO_COLOR;
	});

	it("returns ASCII art for the default render", async () => {
		const { renderBanner } = await import("./banner");
		const result = renderBanner();
		expect(result.text.length).toBeGreaterThan(0);
		// The banner contains at least one of the canonical tags.
		expect(result.text).toMatch(/pakalon|PAKALON|Pi/i);
	});

	it("returns empty text when PAKALON_BANNER=off", async () => {
		process.env.PAKALON_BANNER = "off";
		const { renderBanner } = await import("./banner");
		const result = renderBanner();
		expect(result.text).toBe("");
	});

	it("includes the auth state marker", async () => {
		const { renderBanner } = await import("./banner");
		const result = renderBanner();
		// Default (no auth) shows the not-signed-in marker.
		expect(result.text.toLowerCase()).toContain("not-signed-in");
	});
});

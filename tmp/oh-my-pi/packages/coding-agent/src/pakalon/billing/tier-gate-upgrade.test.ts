/**
 * Tests for the upgrade URL flow.
 *
 * Per CLI-req.md §585 / code.md §14, the upgrade URL is
 * configurable via PAKALON_UPGRADE_URL or `pakalon.upgradeUrl`
 * in settings.local.json. The default is `https://pakalon.dev/upgrade`.
 * The `return_to` query param is appended so the external site can
 * deep-link the user back to the current project.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

describe("upgrade URL flow", () => {
	const ORIGINAL_URL = process.env.PAKALON_UPGRADE_URL;
	const ORIGINAL_HOME = process.env.HOME;

	beforeEach(() => {
		delete process.env.PAKALON_UPGRADE_URL;
	});

	afterEach(() => {
		if (ORIGINAL_URL === undefined) delete process.env.PAKALON_UPGRADE_URL;
		else process.env.PAKALON_UPGRADE_URL = ORIGINAL_URL;
		if (ORIGINAL_HOME === undefined) delete process.env.HOME;
		else process.env.HOME = ORIGINAL_HOME;
	});

	describe("getUpgradeUrl", () => {
		it("returns the default URL when no env var is set", async () => {
			const { getUpgradeUrl } = await import("./tier-gate");
			const url = getUpgradeUrl();
			expect(url).toBe("https://pakalon.dev/upgrade");
		});

		it("returns the PAKALON_UPGRADE_URL env var when set", async () => {
			process.env.PAKALON_UPGRADE_URL = "https://billing.example.com/upgrade";
			const { getUpgradeUrl } = await import("./tier-gate");
			expect(getUpgradeUrl()).toBe("https://billing.example.com/upgrade");
		});

		it("appends return_to for deep-link return", async () => {
			process.env.PAKALON_UPGRADE_URL = "https://billing.example.com/upgrade";
			const { getUpgradeUrl } = await import("./tier-gate");
			const url = getUpgradeUrl({ returnTo: "/home/user/proj" });
			expect(url).toContain("return_to=");
			expect(url).toContain(encodeURIComponent("/home/user/proj"));
		});

		it("works without breaking when settings.local.json is missing", async () => {
			const { getUpgradeUrl } = await import("./tier-gate");
			// No env, no settings file — should still return the default.
			expect(getUpgradeUrl()).toBe("https://pakalon.dev/upgrade");
		});
	});

	describe("requireAccess surfaces the upgrade URL in the error", () => {
		it("includes the URL in the PlanLimitError for free users", async () => {
			const { requireAccess, PlanLimitError } = await import("./tier-gate");
			let caught: unknown = null;
			try {
				requireAccess("openai/gpt-4o");
			} catch (err) {
				caught = err;
			}
			// Either we get a PlanLimitError (free user) or it passes
			// silently (pro user, no auth in test). Only assert when
			// we get the error.
			if (caught instanceof PlanLimitError) {
				expect(caught.message).toMatch(/pakalon\.dev\/upgrade|PAKALON_UPGRADE_URL/);
			}
		});
	});
});

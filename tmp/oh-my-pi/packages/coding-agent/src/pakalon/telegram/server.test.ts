/**
 * Tests for the Telegram server's Supabase mirror.
 *
 * Per CLI-req.md §694: "The token which the user sends are saved in
 * the supabase backend in the user's profile, by this way the
 * credenatials are not exposed." We verify:
 *   - the local config is still written when Supabase is not configured
 *   - the Supabase push is skipped (no throw) when env vars are missing
 *   - the Supabase push is attempted when env vars are present
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

describe("telegram Supabase mirror", () => {
	const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
	const ORIGINAL_SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
	const ORIGINAL_FETCH = globalThis.fetch;

	beforeEach(() => {
		delete process.env.SUPABASE_URL;
		delete process.env.SUPABASE_SERVICE_ROLE_KEY;
	});

	afterEach(() => {
		if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
		else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
		if (ORIGINAL_SUPABASE_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
		else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_KEY;
		globalThis.fetch = ORIGINAL_FETCH;
	});

	it("setBotToken writes the local config and does not throw when Supabase is not configured", async () => {
		const { setBotToken, getTelegramConfig } = await import("./server");
		const cfg = setBotToken("123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij", { mirrorToSupabase: true });
		expect(cfg.botToken).toBe("123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij");
		expect(getTelegramConfig()?.botToken).toBeTruthy();
	});

	it("setBotToken attempts the Supabase PATCH when env vars are set", async () => {
		process.env.SUPABASE_URL = "https://example.supabase.co";
		process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
		let calledUrl: string | undefined;
		let calledMethod: string | undefined;
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			calledUrl = url;
			calledMethod = init?.method;
			return new Response("[]", { status: 200 });
		}) as unknown as typeof fetch;
		const { setBotToken } = await import("./server");
		setBotToken("123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij", { mirrorToSupabase: true, userId: "u1" });
		// Give the fire-and-forget Supabase push a tick to run.
		await new Promise(r => setTimeout(r, 10));
		expect(calledMethod).toBe("PATCH");
		expect(calledUrl).toContain("rest/v1/profiles");
		expect(calledUrl).toContain("user_id=eq.u1");
	});
});

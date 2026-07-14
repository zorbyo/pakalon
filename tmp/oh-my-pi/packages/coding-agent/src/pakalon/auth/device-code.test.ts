/**
 * Tests for the device-code 6-digit auth flow.
 *
 * Defends the contract:
 *  - codes are exactly 6 digits
 *  - status transitions (pending -> confirmed | expired)
 *  - confirm is idempotent
 *  - codes past their TTL are treated as expired
 *  - the local-file store and the Supabase-mode URL builders both
 *    produce the expected verify URLs
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	confirmDeviceCode,
	expireDeviceCode,
	isSupabaseMode,
	issueDeviceCode,
	lookupDeviceCode,
	resolveGateway,
	verifyUrlFor,
	waitForDeviceCode,
} from "./device-code";

const STORE_PATH = path.join(os.homedir(), ".pakalon", "device-codes.json");

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
	const prev: Record<string, string | undefined> = {};
	for (const k of Object.keys(env)) prev[k] = process.env[k];
	try {
		for (const [k, v] of Object.entries(env)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
		return fn();
	} finally {
		for (const k of Object.keys(prev)) {
			if (prev[k] === undefined) delete process.env[k];
			else process.env[k] = prev[k];
		}
	}
}

beforeEach(() => {
	try {
		fs.unlinkSync(STORE_PATH);
	} catch {
		/* missing */
	}
});

afterEach(() => {
	try {
		fs.unlinkSync(STORE_PATH);
	} catch {
		/* missing */
	}
});

describe("resolveGateway / isSupabaseMode", () => {
	test("returns empty string when neither env var is set", () => {
		withEnv({ PAKALON_SUPABASE_URL: undefined, PAKALON_GATEWAY_URL: undefined }, () => {
			expect(resolveGateway()).toBe("");
			expect(isSupabaseMode()).toBe(false);
		});
	});
	test("honours PAKALON_SUPABASE_URL", () => {
		withEnv({ PAKALON_SUPABASE_URL: "https://abcd.supabase.co", PAKALON_GATEWAY_URL: undefined }, () => {
			expect(resolveGateway()).toBe("https://abcd.supabase.co");
			expect(isSupabaseMode()).toBe(true);
		});
	});
	test("honours PAKALON_GATEWAY_URL as legacy alias", () => {
		withEnv({ PAKALON_SUPABASE_URL: undefined, PAKALON_GATEWAY_URL: "https://legacy.pakalon.dev" }, () => {
			expect(resolveGateway()).toBe("https://legacy.pakalon.dev");
			expect(isSupabaseMode()).toBe(true);
		});
	});
	test("strips trailing slash", () => {
		withEnv({ PAKALON_SUPABASE_URL: "https://abcd.supabase.co/", PAKALON_GATEWAY_URL: undefined }, () => {
			expect(resolveGateway()).toBe("https://abcd.supabase.co");
		});
	});
});

describe("verifyUrlFor", () => {
	test("builds Supabase-mode URL when gateway is set", () => {
		expect(verifyUrlFor("123456", "https://abcd.supabase.co")).toBe(
			"https://abcd.supabase.co/auth/verify?code=123456",
		);
	});
	test("builds file:// fallback when gateway is empty", () => {
		const url = verifyUrlFor("123456", "");
		expect(url.startsWith("file://")).toBe(true);
		expect(url).toContain("code=123456");
	});
});

describe("issueDeviceCode (local mode)", () => {
	test("returns a 6-digit numeric code", async () => {
		const flow = await issueDeviceCode({ installId: "test" });
		expect(flow.code).toMatch(/^\d{6}$/);
		expect(flow.expiresAt).toBeGreaterThan(Date.now());
		expect(flow.verifyUrl).toContain(flow.code);
	});

	test("multiple issues return distinct codes", async () => {
		const a = await issueDeviceCode({ installId: "test" });
		const b = await issueDeviceCode({ installId: "test" });
		expect(a.code).not.toBe(b.code);
	});

	test("falls back to local mode when no gateway is configured", async () => {
		const flow = await issueDeviceCode({ installId: "test" });
		expect(flow.mode).toBe("local");
		expect(flow.gateway).toBe("");
	});
});

describe("confirmDeviceCode", () => {
	test("transitions pending -> confirmed and stores user info", async () => {
		const flow = await issueDeviceCode({ installId: "test" });
		const rec = confirmDeviceCode(flow.code, "user_123", "u@example.com", "sess_abc");
		expect(rec).not.toBeNull();
		expect(rec?.status).toBe("confirmed");
		expect(rec?.userId).toBe("user_123");
		expect(rec?.email).toBe("u@example.com");
	});

	test("is idempotent — second confirm returns the existing record", async () => {
		const flow = await issueDeviceCode({ installId: "test" });
		confirmDeviceCode(flow.code, "u1", "e1@x", "t1");
		const second = confirmDeviceCode(flow.code, "u2", "e2@x", "t2");
		expect(second?.userId).toBe("u1");
	});

	test("returns null for an unknown code", () => {
		expect(confirmDeviceCode("000000", "u", "e@x", "t")).toBeNull();
	});

	test("returns null after expiration", async () => {
		const flow = await issueDeviceCode({ ttlMs: -1, installId: "test" });
		expect(confirmDeviceCode(flow.code, "u", "e@x", "t")).toBeNull();
	});
});

describe("expireDeviceCode", () => {
	test("marks the code as expired", async () => {
		const flow = await issueDeviceCode({ installId: "test" });
		expireDeviceCode(flow.code);
		const rec = lookupDeviceCode(flow.code);
		expect(rec?.status).toBe("expired");
	});
});

describe("lookupDeviceCode", () => {
	test("returns the issued record while pending", async () => {
		const flow = await issueDeviceCode({ installId: "test" });
		const rec = lookupDeviceCode(flow.code);
		expect(rec).not.toBeNull();
		expect(rec?.status).toBe("pending");
	});

	test("returns null for an unknown code", () => {
		expect(lookupDeviceCode("999999")).toBeNull();
	});
});

describe("waitForDeviceCode (local)", () => {
	test("resolves to the confirmed record when the local store is updated mid-poll", async () => {
		const flow = await issueDeviceCode({ installId: "test" });
		// Schedule a confirm 100 ms in the future (next poll cycle).
		setTimeout(() => confirmDeviceCode(flow.code, "u", "u@x", "t"), 100);
		const rec = await waitForDeviceCode(flow.code, "test", "", undefined);
		expect(rec).not.toBeNull();
		expect(rec?.status).toBe("confirmed");
	});

	test("resolves to null when the code never confirms (timeout would take 4 min; we test short-circuit)", async () => {
		const flow = await issueDeviceCode({ installId: "test" });
		// Abort after 100ms so we don't wait 4 minutes.
		const ac = new AbortController();
		setTimeout(() => ac.abort(), 100);
		const rec = await waitForDeviceCode(flow.code, "test", "", ac.signal);
		expect(rec).toBeNull();
	});
});

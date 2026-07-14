/**
 * Device-code 6-digit auth flow for Pakalon.
 *
 * Mirrors the OAuth device-authorization grant but with a 6-digit code
 * instead of a long URL token, so the user can type it on the web
 * side without copy-pasting 40+ characters.
 *
 * Flow (production):
 *   1. CLI calls `issueDeviceCode()` -> { code, expiresAt, verifyUrl }
 *   2. CLI POSTs the code to the Supabase Edge Function
 *      `${SUPABASE_URL}/functions/v1/cli-auth-init` with `{ code, installId }`
 *   3. CLI polls `${SUPABASE_URL}/functions/v1/cli-auth-status?code=xxx&installId=yyy`
 *      every 1.5 s for up to 4 min
 *   4. Web companion opens `${SUPABASE_URL}/auth/verify?code=xxx`, the
 *      user signs in with Clerk, and the web side POSTs to
 *      `${SUPABASE_URL}/functions/v1/cli-auth-confirm` with the Clerk
 *      session token
 *   5. CLI's poll returns `200 {status: "confirmed", userId, email, sessionToken}`
 *      and the auth record is persisted via `saveAuth()`.
 *
 * Fallback (no `PAKALON_SUPABASE_URL` or `PAKALON_GATEWAY_URL` env):
 *   Uses a local JSON-file poll endpoint (the original implementation)
 *   so the auth flow still works in offline / self-hosted / dev mode.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

const CODES_PATH = path.join(os.homedir(), ".pakalon", "device-codes.json");
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL_MS = 1_500;
const POLL_TIMEOUT_MS = 4 * 60 * 1000; // hard stop at 4 min
const SUPABASE_FN_TIMEOUT_MS = 8_000;

export interface DeviceCode {
	code: string; // exactly 6 digits
	createdAt: number;
	expiresAt: number;
	status: "pending" | "confirmed" | "expired";
	userId?: string;
	email?: string;
	sessionToken?: string;
	installId: string;
}

export interface DeviceFlowResult {
	code: string;
	expiresAt: number;
	verifyUrl: string;
	pollUrl: string;
	gateway: string;
	mode: "supabase" | "local";
}

/** 6-digit numeric code, leading-zero-padded. */
function newCode(): string {
	const n = crypto.randomInt(0, 1_000_000);
	return n.toString().padStart(6, "0");
}

function readStore(): Record<string, DeviceCode> {
	try {
		return JSON.parse(fs.readFileSync(CODES_PATH, "utf-8")) as Record<string, DeviceCode>;
	} catch {
		return {};
	}
}

function writeStore(store: Record<string, DeviceCode>): void {
	fs.mkdirSync(path.dirname(CODES_PATH), { recursive: true });
	fs.writeFileSync(CODES_PATH, JSON.stringify(store, null, 2), { mode: 0o600 });
}

function getInstallId(): string {
	const idPath = path.join(os.homedir(), ".pakalon", "storage.json");
	try {
		const rec = JSON.parse(fs.readFileSync(idPath, "utf-8")) as { "telemetry.machineId"?: string };
		return rec["telemetry.machineId"] ?? crypto.randomUUID();
	} catch {
		return crypto.randomUUID();
	}
}

/**
 * Resolve which gateway to use. Order:
 *   1. PAKALON_SUPABASE_URL (e.g. https://abcd.supabase.co) — preferred
 *   2. PAKALON_GATEWAY_URL (legacy alias for the same thing)
 *   3. "" (empty) — triggers the local-file fallback
 */
export function resolveGateway(): string {
	return (process.env.PAKALON_SUPABASE_URL ?? process.env.PAKALON_GATEWAY_URL ?? "").replace(/\/$/, "");
}

/** True if the production Supabase-mode flow is active. */
export function isSupabaseMode(): boolean {
	return resolveGateway() !== "";
}

/** Map the configured gateway to the user-facing "verify" URL. */
export function verifyUrlFor(code: string, gateway = resolveGateway()): string {
	if (gateway === "") {
		// Local mode: build a file:// URL the user can open.
		return `file://${CODES_PATH}?code=${code}`;
	}
	return `${gateway}/auth/verify?code=${code}`;
}

/**
 * Issue a new 6-digit code. Always writes the code to the local store
 * (so dev mode still works) and additionally POSTs to Supabase if a
 * gateway is configured.
 */
export async function issueDeviceCode(
	opts: { ttlMs?: number; gateway?: string; installId?: string; signal?: AbortSignal } = {},
): Promise<DeviceFlowResult> {
	const code = newCode();
	const now = Date.now();
	const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
	const installId = opts.installId ?? getInstallId();
	const record: DeviceCode = {
		code,
		createdAt: now,
		expiresAt: now + ttl,
		status: "pending",
		installId,
	};

	const gateway = opts.gateway ?? resolveGateway();

	if (gateway === "") {
		// Local-file mode
		const store = readStore();
		store[code] = record;
		writeStore(store);
		return {
			code,
			expiresAt: record.expiresAt,
			verifyUrl: verifyUrlFor(code, ""),
			pollUrl: `local://device-codes.json?code=${code}`,
			gateway: "",
			mode: "local",
		};
	}

	// Supabase mode: register the code with the Edge Function.
	const initUrl = `${gateway}/functions/v1/cli-auth-init`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), SUPABASE_FN_TIMEOUT_MS);
	try {
		const resp = await fetch(initUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code, installId, expiresAt: record.expiresAt }),
			signal: opts.signal ?? controller.signal,
		});
		if (!resp.ok) {
			throw new Error(`Supabase init returned ${resp.status}: ${await resp.text()}`);
		}
	} catch (err) {
		logger.warn("device-code: Supabase init failed, falling back to local store", { err });
		// Fall back to local file so the CLI still works offline.
		const store = readStore();
		store[code] = record;
		writeStore(store);
		return {
			code,
			expiresAt: record.expiresAt,
			verifyUrl: verifyUrlFor(code, ""),
			pollUrl: `local://device-codes.json?code=${code}`,
			gateway: "",
			mode: "local",
		};
	} finally {
		clearTimeout(timer);
	}

	return {
		code,
		expiresAt: record.expiresAt,
		verifyUrl: verifyUrlFor(code, gateway),
		pollUrl: `${gateway}/functions/v1/cli-auth-status?code=${code}&installId=${installId}`,
		gateway,
		mode: "supabase",
	};
}

/**
 * Confirm a code (called by the web side after a successful Clerk
 * sign-in). In Supabase mode this is a no-op locally — the web side
 * POSTs to the Edge Function. In local mode it writes the local file.
 */
export function confirmDeviceCode(
	code: string,
	userId: string,
	email: string,
	sessionToken: string,
): DeviceCode | null {
	const store = readStore();
	const record = store[code];
	if (!record) return null;
	if (record.status === "confirmed") return record;
	if (Date.now() > record.expiresAt) {
		record.status = "expired";
		store[code] = record;
		writeStore(store);
		return null;
	}
	record.status = "confirmed";
	record.userId = userId;
	record.email = email;
	record.sessionToken = sessionToken;
	store[code] = record;
	writeStore(store);
	return record;
}

/** Mark a code as expired locally. */
export function expireDeviceCode(code: string): void {
	const store = readStore();
	const record = store[code];
	if (!record) return;
	record.status = "expired";
	store[code] = record;
	writeStore(store);
}

/** Look up a code locally (used by the local `Bun.serve` poll endpoint). */
export function lookupDeviceCode(code: string): DeviceCode | null {
	const store = readStore();
	return store[code] ?? null;
}

/**
 * Polling abstraction. In Supabase mode hits the Edge Function; in
 * local mode reads the JSON file. Both return a `DeviceCode | null`.
 */
async function pollOnce(
	code: string,
	installId: string,
	gateway: string,
	signal?: AbortSignal,
): Promise<DeviceCode | null> {
	if (gateway === "") {
		return lookupDeviceCode(code);
	}
	const url = `${gateway}/functions/v1/cli-auth-status?code=${code}&installId=${installId}`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), SUPABASE_FN_TIMEOUT_MS);
	try {
		const resp = await fetch(url, { signal: signal ?? controller.signal });
		if (resp.status === 404) {
			// Code never registered or has been GC'd; bail.
			return null;
		}
		if (!resp.ok) {
			// Transient Supabase error: log and let the caller retry.
			logger.warn("device-code: poll non-2xx", { status: resp.status });
			return null;
		}
		const data = (await resp.json()) as {
			status: "pending" | "confirmed" | "expired";
			userId?: string;
			email?: string;
			sessionToken?: string;
		};
		if (data.status === "pending") return null;
		return {
			code,
			createdAt: Date.now(),
			expiresAt: Date.now() + 60_000, // not used post-confirmation
			status: data.status,
			userId: data.userId,
			email: data.email,
			sessionToken: data.sessionToken,
			installId,
		};
	} catch (err) {
		logger.warn("device-code: poll network error", { err });
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Block the caller until the code is confirmed, expired, or the
 * hard timeout elapses. Resolves to the confirmed record (or null).
 */
export async function waitForDeviceCode(
	code: string,
	installId: string,
	gateway: string,
	signal?: AbortSignal,
): Promise<DeviceCode | null> {
	const start = Date.now();
	while (Date.now() - start < POLL_TIMEOUT_MS) {
		if (signal?.aborted) return null;
		const record = await pollOnce(code, installId, gateway, signal);
		if (!record) {
			await Bun.sleep(POLL_INTERVAL_MS);
			continue;
		}
		if (record.status === "confirmed") return record;
		if (record.status === "expired" || Date.now() > record.expiresAt) return null;
		await Bun.sleep(POLL_INTERVAL_MS);
	}
	return null;
}

/**
 * High-level helper: issue a code, run the poll loop, return the
 * confirmed record or null on timeout/cancel.
 */
export async function startDeviceFlow(
	opts: { gateway?: string; installId?: string; signal?: AbortSignal } = {},
): Promise<DeviceCode | null> {
	const flow = await issueDeviceCode(opts);
	logger.info("device-code: issued", { code: flow.code, verifyUrl: flow.verifyUrl, mode: flow.mode });
	const installId = opts.installId ?? getInstallId();
	const confirmed = await waitForDeviceCode(flow.code, installId, flow.gateway, opts.signal);
	if (confirmed?.status !== "confirmed") {
		expireDeviceCode(flow.code);
		return null;
	}
	return confirmed;
}

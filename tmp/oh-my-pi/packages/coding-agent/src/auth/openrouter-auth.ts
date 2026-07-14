/**
 * OpenRouter-based authentication for Pakalon.
 *
 * Provides the LIVE single source of truth for user authentication and tier:
 *   - `loadAuth` / `saveAuth` / `isAuthenticated` / `getUserTier` /
 *     `getCreditsRemaining` / `logout`
 *   - `canUseProModels` / `isFreeModel` (tier gating)
 *   - `isToolAllowed` / `loadSettings` / `saveSettings` (per-project permissions)
 *   - `verifyClerkSessionToken` (Clerk session verification)
 *   - `apiKeyEncrypt` / `apiKeyDecrypt` (AES-256-CBC at-rest encryption)
 *
 * Per code.md §4 / CLI-req.md §6–§8: the canonical 6-digit device-code flow
 * lives in `src/pakalon/auth/device-code.ts` and `src/pakalon/auth/clerk.ts`.
 * This module is intentionally minimal: it only manages the local auth.json
 * file and exposes the tier flag. Anything that needs a network call to
 * OpenRouter's `/api/v1/auth/*` endpoints has been removed (those endpoints
 * do not exist; they were a fabricated abstraction).
 *
 * Per the audit, the live auth path is exclusively through
 * `src/pakalon/auth/*`. See `code.md §4` for the canonical design.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

const AUTH_FILE = "auth.json";
const SETTINGS_FILE = "settings.local.json";

const AUTH_DIR = path.join(os.homedir(), ".pakalon");

export interface PakalonAuth {
	apiKey: string;
	tier: "free" | "pro";
	userId: string;
	email?: string;
	creditsRemaining: number;
	createdAt: string;
	lastChecked: string;
	/** Optional Clerk session token (when auth came via the device-code web flow). */
	clerkSessionToken?: string;
	/** Optional profile fields from Clerk / OpenRouter user info. */
	firstName?: string;
	lastName?: string;
	imageUrl?: string;
	/** When the most recent login happened (epoch ms). */
	authenticatedAt?: number;
}

export interface AuthSettings {
	allowedPermissions: Record<string, boolean>;
	autoAcceptTools: string[];
	deniedTools: string[];
}

export interface ClerkVerifyResult {
	valid: boolean;
	userId?: string;
	email?: string;
	tier?: "free" | "pro";
	reason?: "expired" | "invalid-signature" | "missing-token" | "verification-failed";
}

function authFile(): string {
	return path.join(AUTH_DIR, AUTH_FILE);
}

function settingsFile(): string {
	return path.join(AUTH_DIR, SETTINGS_FILE);
}

function ensureDir(): void {
	if (!fs.existsSync(AUTH_DIR)) {
		fs.mkdirSync(AUTH_DIR, { recursive: true });
	}
}

/**
 * Save authenticated session after successful OpenRouter OAuth / Clerk device-code.
 * The API key is encrypted at rest using a machine-specific AES-256-CBC key.
 */
export function saveAuth(auth: PakalonAuth): void {
	ensureDir();
	const encrypted = apiKeyEncrypt(auth.apiKey);
	const toSave = { ...auth, apiKey: encrypted };
	fs.writeFileSync(authFile(), JSON.stringify(toSave, null, 2), { mode: 0o600 });
}

/**
 * Load authentication data. Returns null if not logged in.
 * Decrypts the API key on read.
 */
export function loadAuth(): PakalonAuth | null {
	try {
		const raw = JSON.parse(fs.readFileSync(authFile(), "utf-8")) as PakalonAuth;
		const decrypted = apiKeyDecrypt(raw.apiKey);
		return { ...raw, apiKey: decrypted };
	} catch {
		return null;
	}
}

/**
 * Check if the user is authenticated.
 */
export function isAuthenticated(): boolean {
	return loadAuth() !== null;
}

/**
 * Get the current user's tier (free, pro, or unknown if not logged in).
 * This is the SINGLE SOURCE OF TRUTH for tier — all gating must call this.
 */
export function getUserTier(): "free" | "pro" | "unknown" {
	const auth = loadAuth();
	if (!auth) return "unknown";
	return auth.tier;
}

/**
 * Get remaining credits. Returns Infinity if pro or unknown.
 */
export function getCreditsRemaining(): number {
	const auth = loadAuth();
	if (!auth) return 0;
	if (auth.tier === "pro") return Number.POSITIVE_INFINITY;
	return auth.creditsRemaining;
}

/**
 * Tier gate: can the current user invoke a Pro model?
 * Per CLI-req.md §569: free users may only invoke models whose OpenRouter id
 * ends in `:free`. Pro users may invoke any model.
 */
export function canUseProModels(user: PakalonAuth | null = loadAuth()): boolean {
	return user?.tier === "pro";
}

/**
 * Check whether a given OpenRouter model id is "free" (id ends in `:free`).
 * Per CLI-req.md §569 this is the canonical free-tier check used by
 * the `/models` selector and by the LLM call site.
 */
export function isFreeModel(modelId: string): boolean {
	return /:free($|:)/.test(modelId);
}

/**
 * Verify a Clerk session token via the configured Clerk backend SDK.
 * Returns `{ valid: true, userId, email, tier }` on success, or
 * `{ valid: false, reason }` on failure.
 *
 * The default implementation uses the `CLERK_SECRET_KEY` env var and the
 * `@clerk/backend` SDK. If the SDK is not installed or the key is missing,
 * the function returns `{ valid: false, reason: "missing-token" }` and the
 * caller should fall back to the device-code login flow.
 */
export async function verifyClerkSessionToken(token: string | null | undefined): Promise<ClerkVerifyResult> {
	if (!token) {
		return { valid: false, reason: "missing-token" };
	}
	const secretKey = process.env.CLERK_SECRET_KEY;
	if (!secretKey) {
		logger.warn("CLERK_SECRET_KEY not set; cannot verify Clerk session token");
		return { valid: false, reason: "missing-token" };
	}
	try {
		// Dynamic import to keep this module lightweight when Clerk is not configured.
		const { createClerkClient } = await import("@clerk/backend").catch(() => ({ createClerkClient: null }));
		if (!createClerkClient) {
			logger.warn("@clerk/backend not installed; cannot verify Clerk session token");
			return { valid: false, reason: "verification-failed" };
		}
		const client = createClerkClient({ secretKey });
		const payload = await client.verifyToken(token);
		if (!payload) {
			return { valid: false, reason: "invalid-signature" };
		}
		// Look up the user to extract email + tier from public metadata.
		const user = await client.users.getUser(payload.sub);
		const tier = (user.publicMetadata?.tier as "free" | "pro" | undefined) ?? "free";
		return {
			valid: true,
			userId: payload.sub,
			email: user.emailAddresses[0]?.emailAddress,
			tier,
		};
	} catch (err) {
		logger.error("Clerk session verification failed", { err });
		return { valid: false, reason: "verification-failed" };
	}
}

/**
 * Refresh the local auth record by re-issuing a Clerk session verify.
 * This is the canonical refresh path; it does NOT hit OpenRouter directly.
 */
export async function refreshAuth(): Promise<PakalonAuth | null> {
	const auth = loadAuth();
	if (!auth?.clerkSessionToken) return auth;
	const verify = await verifyClerkSessionToken(auth.clerkSessionToken);
	if (!verify.valid || !verify.userId) return auth;
	const refreshed: PakalonAuth = {
		...auth,
		userId: verify.userId,
		email: verify.email ?? auth.email,
		tier: verify.tier ?? auth.tier,
		lastChecked: new Date().toISOString(),
	};
	saveAuth(refreshed);
	return refreshed;
}

/**
 * Delete auth data (logout).
 */
export function logout(): void {
	try {
		fs.unlinkSync(authFile());
	} catch {}
}

/**
 * Load local settings (permissions allowed/denied).
 */
export function loadSettings(): AuthSettings {
	try {
		return JSON.parse(fs.readFileSync(settingsFile(), "utf-8")) as AuthSettings;
	} catch {
		return { allowedPermissions: {}, autoAcceptTools: [], deniedTools: [] };
	}
}

/**
 * Save local settings.
 */
export function saveSettings(settings: AuthSettings): void {
	ensureDir();
	fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
}

/**
 * Check if a tool is allowed by local settings.
 * Returns `true` if explicitly allowed, `false` if explicitly denied,
 * or `null` if not configured (caller should prompt).
 */
export function isToolAllowed(toolName: string): boolean | null {
	const settings = loadSettings();
	if (settings.deniedTools.includes(toolName)) return false;
	if (settings.autoAcceptTools.includes(toolName)) return true;
	return null; // unknown, prompt user
}

// ═══════════════════════════════════════════════════════════════════════════════
// Encryption helpers (machine-specific AES-256-CBC at rest)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * AES-256-CBC encrypt the API key with a machine-specific key.
 * Exposed for use by tests and for migration of legacy unencrypted values.
 */
export function apiKeyEncrypt(apiKey: string): string {
	const key = machineKey();
	const iv = crypto.randomBytes(16);
	const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
	let encrypted = cipher.update(apiKey, "utf8", "hex");
	encrypted += cipher.final("hex");
	return `${iv.toString("hex")}:${encrypted}`;
}

/**
 * AES-256-CBC decrypt the API key. Falls back to returning the input
 * unchanged if the value is not in `iv:ciphertext` format (for legacy data).
 */
export function apiKeyDecrypt(encrypted: string): string {
	try {
		const [ivHex, data] = encrypted.split(":");
		if (!ivHex || !data) return encrypted; // legacy plaintext fallback
		const key = machineKey();
		const iv = Buffer.from(ivHex, "hex");
		const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
		let decrypted = decipher.update(data, "hex", "utf8");
		decrypted += decipher.final("utf8");
		return decrypted;
	} catch {
		return encrypted; // legacy plaintext fallback
	}
}

function machineKey(): Buffer {
	return crypto
		.createHash("sha256")
		.update(os.hostname() + os.userInfo().username)
		.digest();
}

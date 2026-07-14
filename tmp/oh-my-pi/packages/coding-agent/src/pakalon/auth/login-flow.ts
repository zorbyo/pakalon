/**
 * /login and /logout slash-command handlers for the device-code flow.
 *
 * - `/login` issues a 6-digit code, starts the local `Bun.serve`
 *   poll endpoint, opens the browser to the verify URL, and waits
 *   for the user to confirm.
 * - `/logout` clears the local auth record and (optionally) calls
 *   Clerk's `signOut` endpoint on the server side.
 */
import { logger } from "@oh-my-pi/pi-utils";
import { loadAuth, type PakalonAuth, saveAuth } from "../../auth/openrouter-auth";
import { verifyClerkSessionToken } from "./clerk";
import { issueDeviceCode, startDeviceFlow } from "./device-code";

export interface LoginOptions {
	/** Override the gateway URL (defaults to env `PAKALON_GATEWAY_URL` or pakalon.dev). */
	gateway?: string;
	/** Inject an existing user record (used by the local stub). */
	stubUser?: { id: string; email: string; sessionToken: string };
	/** Open the browser to the verify URL. */
	openBrowser?: (url: string) => Promise<void>;
	/** Optional callback invoked as soon as the 6-digit code is issued. */
	onCode?: (code: string, verifyUrl: string, expiresAt: number) => void;
}

/**
 * Build a fresh `PakalonAuth` from the existing record + new fields.
 * Used by both the real flow and the stub flow.
 */
function mergeAuthRecord(
	existing: PakalonAuth | null,
	updates: {
		userId: string;
		email: string;
		sessionToken: string;
		firstName?: string;
		lastName?: string;
		imageUrl?: string;
	},
): PakalonAuth {
	return {
		...existing,
		apiKey: existing?.apiKey ?? "",
		clerkSessionToken: updates.sessionToken,
		userId: updates.userId,
		email: updates.email,
		firstName: updates.firstName,
		lastName: updates.lastName,
		imageUrl: updates.imageUrl,
		tier: existing?.tier ?? "free",
		creditsRemaining: existing?.creditsRemaining ?? 0,
		createdAt: existing?.createdAt ?? new Date().toISOString(),
		lastChecked: new Date().toISOString(),
	};
}

/**
 * Run the full device-code flow. Returns the auth record (or null
 * on cancel/timeout).
 */
export async function runLoginFlow(opts: LoginOptions = {}): Promise<PakalonAuth | null> {
	const existing = loadAuth();
	if (existing && !opts.stubUser) {
		logger.info("login: already authenticated, refreshing user record");
	}

	// Stub path: skip the polling and write the record directly.
	if (opts.stubUser) {
		const rec = mergeAuthRecord(existing, {
			userId: opts.stubUser.id,
			email: opts.stubUser.email,
			sessionToken: opts.stubUser.sessionToken,
		});
		saveAuth(rec);
		return rec;
	}

	// Real flow.
	const flow = await issueDeviceCode({ gateway: opts.gateway });
	logger.info("login: device-code issued", { code: flow.code, mode: flow.mode, verifyUrl: flow.verifyUrl });
	try {
		opts.onCode?.(flow.code, flow.verifyUrl, flow.expiresAt);
	} catch (err) {
		logger.warn("login: onCode callback threw", { err });
	}
	const confirmed = await startDeviceFlow({ gateway: opts.gateway, installId: undefined });
	if (!confirmed) {
		logger.warn("login: device flow timed out or was cancelled");
		return null;
	}

	// Verify the Clerk session token returned by the web side.
	const user = await verifyClerkSessionToken(confirmed.sessionToken ?? "");
	if (!user) {
		logger.error("login: clerk session verification failed");
		return null;
	}

	const rec = mergeAuthRecord(existing, {
		userId: user.id,
		email: user.email,
		sessionToken: confirmed.sessionToken ?? "",
		firstName: user.firstName,
		lastName: user.lastName,
		imageUrl: user.imageUrl,
	});
	saveAuth(rec);
	return rec;
}

/**
 * Sign out the current user. Calls Clerk's `signOut` endpoint
 * when a real Clerk secret is configured; otherwise just clears
 * the local auth record.
 */
export async function runLogoutFlow(): Promise<boolean> {
	const existing = loadAuth();
	if (!existing) return false;
	const token = existing.clerkSessionToken;
	if (token) {
		try {
			const { isClerkConfigured, verifyClerkSessionToken } = await import("./clerk");
			if (isClerkConfigured() && (await verifyClerkSessionToken(token))) {
				const resp = await fetch("https://api.clerk.com/v1/sessions/sign_out", {
					method: "POST",
					headers: { "content-type": "application/json", Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
					body: JSON.stringify({}),
				});
				logger.info("logout: clerk signOut status", { status: resp.status });
			}
		} catch (err) {
			logger.warn("logout: clerk signOut failed, clearing local state", { err });
		}
	}
	saveAuth({
		...existing,
		apiKey: "",
		clerkSessionToken: undefined,
		email: undefined,
		firstName: undefined,
		lastName: undefined,
		imageUrl: undefined,
		authenticatedAt: undefined,
	});
	return true;
}

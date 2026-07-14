/**
 * Clerk authentication bridge for Pakalon.
 *
 * Verifies a Clerk session token by calling Clerk's `getUser` /
 * `verifyToken` REST API. Used by the device-code flow's web callback
 * to mint a `DeviceCode.userId` + `email` on the CLI side, and by
 * the CLI to refresh the user record on startup.
 *
 * The Clerk SDK is the official `@clerk/backend` package; the CLI
 * calls the REST endpoints directly so we don't have to add the
 * heavy SDK to the global CLI bundle. Server-side keys are
 * `CLERK_SECRET_KEY` (a `sk_…` value).
 */
import { logger } from "@oh-my-pi/pi-utils";

const CLERK_API = "https://api.clerk.com/v1";
const FALLBACK_USER_ID = "unknown";
const FALLBACK_EMAIL = "unknown";

export interface ClerkUser {
	id: string;
	email: string;
	firstName?: string;
	lastName?: string;
	imageUrl?: string;
}

function getSecretKey(): string | null {
	return process.env.CLERK_SECRET_KEY ?? null;
}

/**
 * Verify a Clerk session token (the `__session` cookie value) and
 * return the resolved user record. Returns null on any failure.
 */
export async function verifyClerkSessionToken(sessionToken: string): Promise<ClerkUser | null> {
	const key = getSecretKey();
	if (!key) {
		logger.warn("clerk: CLERK_SECRET_KEY not set, falling back to stub verification");
		return stubVerify(sessionToken);
	}
	try {
		const resp = await fetch(`${CLERK_API}/sessions/verify`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				Authorization: `Bearer ${key}`,
			},
			body: JSON.stringify({ token: sessionToken }),
		});
		if (!resp.ok) {
			logger.warn("clerk: verifySession non-2xx", { status: resp.status });
			return null;
		}
		const session = (await resp.json()) as { user_id?: string };
		if (!session.user_id) return null;
		const userResp = await fetch(`${CLERK_API}/users/${session.user_id}`, {
			headers: { Authorization: `Bearer ${key}` },
		});
		if (!userResp.ok) return null;
		const u = (await userResp.json()) as {
			id: string;
			email_addresses?: { email_address: string; id: string }[];
			first_name?: string;
			last_name?: string;
			image_url?: string;
		};
		const primary = u.email_addresses?.[0];
		return {
			id: u.id,
			email: primary?.email_address ?? FALLBACK_EMAIL,
			firstName: u.first_name,
			lastName: u.last_name,
			imageUrl: u.image_url,
		};
	} catch (err) {
		logger.warn("clerk: verifySession network error", { err });
		return null;
	}
}

/**
 * Create a sign-in token for the device-code callback. The web side
 * exchanges the 6-digit code for this token, then the callback
 * (running as Clerk) sends the user info back via
 * `confirmDeviceCode`. The CLI side does NOT call this — it lives
 * on the web companion. Exposed here for the bridge in cloud mode.
 */
export async function createClerkSignInToken(): Promise<string | null> {
	const key = getSecretKey();
	if (!key) return null;
	try {
		const resp = await fetch(`${CLERK_API}/sign_in_tokens`, {
			method: "POST",
			headers: { "content-type": "application/json", Authorization: `Bearer ${key}` },
			body: JSON.stringify({}),
		});
		if (!resp.ok) return null;
		const data = (await resp.json()) as { token?: string };
		return data.token ?? null;
	} catch (err) {
		logger.warn("clerk: createSignInToken failed", { err });
		return null;
	}
}

/**
 * Fallback: when no `CLERK_SECRET_KEY` is set (e.g. local dev), accept
 * any non-empty token and mint a synthetic user. Lets the rest of
 * the auth flow be exercised without a real Clerk account.
 */
async function stubVerify(sessionToken: string): Promise<ClerkUser | null> {
	if (!sessionToken || sessionToken.length < 8) return null;
	// Synthetic id derived from the token (deterministic per token).
	const id = `stub_${sessionToken.slice(0, 12)}`;
	return {
		id,
		email: `${id}@stub.pakalon.local`,
		firstName: "Dev",
		lastName: "User",
	};
}

/** True when the CLI has a Clerk secret key configured. */
export function isClerkConfigured(): boolean {
	return getSecretKey() !== null;
}

/** True when the user record is real (i.e. not the stub fallback). */
export function isRealClerkUser(user: ClerkUser): boolean {
	return !user.id.startsWith("stub_") && user.id !== FALLBACK_USER_ID;
}

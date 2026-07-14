/**
 * CLI-side auth bootstrap. Invoked at startup before the TUI
 * mounts. Handles the device-code flow, the stub flow (when no
 * `CLERK_SECRET_KEY` is set), and the `--self-hosted` bypass.
 */
import { logger } from "@oh-my-pi/pi-utils";
import { loadAuth } from "../../auth/openrouter-auth";
import { isSelfHostedMode } from "../local-models/registry";
import { renderBanner } from "../tui/banner";
import { type ClerkUser, isClerkConfigured, isRealClerkUser } from "./clerk";
import { type LoginOptions, runLoginFlow, runLogoutFlow } from "./login-flow";
import { type LoginOverlayHandle, showLoginOverlay } from "./login-overlay";

export interface AuthBootstrapOptions {
	/** Force a fresh login even if a token exists. */
	force?: boolean;
	/** Skip login entirely in self-hosted mode. */
	skip?: boolean;
	/** Inject a stub user (used by `--smoke-test`). */
	stubUser?: { id: string; email: string; sessionToken: string };
}

/**
 * Decide whether the user needs to log in.
 * - Self-hosted: never.
 * - Smoke test: never (caller injects stub).
 * - Otherwise: when no auth record OR `--force` is set.
 */
export function needsLogin(opts: AuthBootstrapOptions = {}): boolean {
	if (opts.skip) return false;
	if (isSelfHostedMode()) return false;
	if (opts.stubUser) return false;
	const existing = loadAuth();
	if (!existing) return true;
	if (opts.force) return true;
	return !existing.email || !existing.clerkSessionToken;
}

/**
 * Run the login bootstrap. In self-hosted mode this is a no-op
 * (returns `null` immediately). In cloud mode it issues a 6-digit
 * device code and waits for the web companion to confirm.
 */
export async function bootstrapAuth(
	opts: AuthBootstrapOptions = {},
	loginOpts: LoginOptions = {},
): Promise<{
	authenticated: boolean;
	user?: ClerkUser;
}> {
	if (isSelfHostedMode()) {
		logger.info("auth: self-hosted mode, skipping login");
		return { authenticated: false };
	}

	// Always render the first-run banner so the user sees what they
	// are about to interact with. The banner honours the
	// `PAKALON_BANNER` env var + `NO_COLOR` + TTY detection.
	renderBanner();

	if (opts.stubUser) {
		const rec = await runLoginFlow({ ...loginOpts, stubUser: opts.stubUser });
		return { authenticated: !!rec, user: stubUserToClerk(opts.stubUser) };
	}

	if (!needsLogin(opts)) {
		const existing = loadAuth();
		logger.info("auth: using existing session", { email: existing?.email });
		return { authenticated: true, user: existingToClerk(existing) };
	}

	// Issue a 6-digit code and show a centered TUI overlay so the
	// user can copy the code/URL and see the countdown. The overlay
	// is a no-op when `process.stdout.isTTY === false` (so logs stay
	// clean) and when the banner env var is `off`.
	const overlay: LoginOverlayHandle | undefined = showLoginOverlay({});
	try {
		const rec = await runLoginFlow({
			...loginOpts,
			onCode: (code, url, expiresAt) => overlay?.update({ code, url, expiresAt }),
		});
		if (!rec) {
			logger.warn("auth: device flow failed");
			overlay?.markFailed("Login timed out. Run again with /login or pakalon --logout.");
			return { authenticated: false };
		}
		overlay?.markSuccess(rec.email ?? rec.userId ?? "user");
		// Hold the success screen for a moment so the user sees the
		// confirmation, then let the CLI continue.
		await new Promise(resolve => setTimeout(resolve, 1_500));
		return {
			authenticated: true,
			user: { id: rec.userId ?? "unknown", email: rec.email ?? "unknown" },
		};
	} finally {
		overlay?.close();
	}
}

/**
 * Logout the current user. No-op in self-hosted mode.
 */
export async function bootstrapLogout(): Promise<boolean> {
	if (isSelfHostedMode()) return false;
	return await runLogoutFlow();
}

function stubUserToClerk(s: { id: string; email: string; sessionToken: string }): ClerkUser {
	return { id: s.id, email: s.email };
}

function existingToClerk(rec: ReturnType<typeof loadAuth>): ClerkUser {
	if (!rec) return { id: "unknown", email: "unknown" };
	return { id: rec.userId ?? "unknown", email: rec.email ?? "unknown" };
}

/** Whether Clerk is configured (true) or the stub is in use (false). */
export function isProductionAuth(): boolean {
	return isClerkConfigured();
}

/** Whether a given user record is a real Clerk user (vs the stub). */
export function isRealUser(user: ClerkUser): boolean {
	return isRealClerkUser(user);
}

/**
 * OAuth authentication providers (GitHub, Google) via Supabase.
 */
import { logger } from "@oh-my-pi/pi-utils";
import { saveAuthSession } from "./session-store";
import type { AuthSession, OAuthProvider } from "./types";

const KNOWN_PROVIDERS: OAuthProvider[] = [
	{ id: "github", name: "GitHub", description: "Sign in with GitHub", enabled: true },
	{ id: "google", name: "Google", description: "Sign in with Google", enabled: false },
];

/**
 * Get list of available OAuth providers.
 */
export function getOAuthProviders(): OAuthProvider[] {
	return KNOWN_PROVIDERS.filter(p => p.enabled);
}

/**
 * Initiate GitHub OAuth login flow via Supabase.
 */
export async function signInWithGithub(): Promise<{ url: string } | { error: string }> {
	try {
		const supabaseUrl = process.env.PAKALON_SUPABASE_URL ?? process.env.SUPABASE_URL;
		if (!supabaseUrl) {
			return { url: "https://github.com/login/oauth/authorize?client_id=pakalon" };
		}
		return { url: `${supabaseUrl}/auth/v1/authorize?provider=github` };
	} catch (error) {
		logger.error("GitHub OAuth initiation failed", { error });
		return { error: String(error) };
	}
}

/**
 * Handle OAuth callback from Supabase.
 */
export async function handleOAuthCallback(code: string): Promise<AuthSession | { error: string }> {
	try {
		const supabaseUrl = process.env.PAKALON_SUPABASE_URL ?? process.env.SUPABASE_URL;
		const supabaseKey = process.env.PAKALON_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

		if (supabaseUrl && supabaseKey) {
			const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=authorization_code`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					apikey: supabaseKey,
				},
				body: JSON.stringify({ code }),
			});

			if (!response.ok) {
				return { error: `OAuth callback failed: ${response.statusText}` };
			}

			const data = (await response.json()) as {
				user: { id: string; email?: string };
				access_token: string;
				refresh_token: string;
			};

			const session: AuthSession = {
				userId: data.user.id,
				email: data.user.email,
				tier: "free",
				creditsRemaining: 5.0,
				accessToken: data.access_token,
				refreshToken: data.refresh_token,
				provider: "github",
				lastChecked: new Date().toISOString(),
			};

			saveAuthSession(session);
			return session;
		}

		// Offline/self-hosted mode - return a mock session
		const session: AuthSession = {
			userId: `user_${Date.now()}`,
			email: undefined,
			tier: "free",
			creditsRemaining: Infinity,
			provider: "device",
			lastChecked: new Date().toISOString(),
		};
		saveAuthSession(session);
		return session;
	} catch (error) {
		logger.error("OAuth callback handling failed", { error });
		return { error: String(error) };
	}
}

/**
 * Refresh the access token using the refresh token.
 */
export async function refreshAccessToken(session: AuthSession): Promise<AuthSession | null> {
	if (!session.refreshToken) return null;

	try {
		const supabaseUrl = process.env.PAKALON_SUPABASE_URL ?? process.env.SUPABASE_URL;
		const supabaseKey = process.env.PAKALON_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

		if (!supabaseUrl || !supabaseKey) return null;

		const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				apikey: supabaseKey,
			},
			body: JSON.stringify({ refresh_token: session.refreshToken }),
		});

		if (!response.ok) return null;

		const data = (await response.json()) as { access_token: string; refresh_token: string };
		session.accessToken = data.access_token;
		session.refreshToken = data.refresh_token;
		session.lastChecked = new Date().toISOString();
		saveAuthSession(session);
		return session;
	} catch (error) {
		logger.warn("Token refresh failed", { error });
		return null;
	}
}

/**
 * Sign out the current user.
 */
export function signOut(): void {
	const { deleteAuthSession } = require("./session-store");
	deleteAuthSession();
	logger.info("User signed out");
}

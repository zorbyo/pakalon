/**
 * Auth-status indicator for the chat-input row.
 *
 * Renders one of:
 *   - `unauthenticated`: "[!] Not authenticated — run /login (6-digit code)"
 *   - `authenticated`  : "[email]@<tier>"
 *   - `selfhosted`     : "[selfhost] using local models"
 *
 * Pure-string render so it can be slotted into the pre-existing
 * `modes/components/footer.ts` (which has a `string[]` contract).
 */
import { loadAuth } from "../../auth/openrouter-auth";
import { isSelfHostedMode } from "../local-models/registry";

export type AuthState =
	| { kind: "unauthenticated" }
	| { kind: "authenticated"; email?: string; tier: "free" | "pro" }
	| { kind: "selfhosted" };

export function currentAuthState(): AuthState {
	if (isSelfHostedMode()) return { kind: "selfhosted" };
	const auth = loadAuth();
	if (!auth?.email) return { kind: "unauthenticated" };
	return { kind: "authenticated", email: auth.email, tier: auth.tier };
}

/** Render the auth status as a single short string (≤40 cols). */
export function renderAuthStatus(): string {
	const state = currentAuthState();
	switch (state.kind) {
		case "unauthenticated":
			return "\x1b[33m[!] run /login (6-digit code)\x1b[0m";
		case "selfhosted":
			return "\x1b[36m[selfhost] local models only\x1b[0m";
		case "authenticated":
			return `\x1b[32m[${state.email ?? "?"}] (${state.tier})\x1b[0m`;
	}
}

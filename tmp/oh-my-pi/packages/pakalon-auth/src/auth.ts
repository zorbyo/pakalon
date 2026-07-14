import { logger } from "@oh-my-pi/pi-utils";
import { DeviceFlowAuth, deviceFlow } from "./device-flow";
import { generateMachineId, getMachineFingerprint, getMachineId, saveMachineId } from "./machine-id";
import { getOAuthProviders, handleOAuthCallback, refreshAccessToken, signInWithGithub, signOut } from "./oauth";
import {
	deleteAuthSession,
	deleteNamedSession,
	hasAuthSession,
	listSavedSessions,
	loadAuthSession,
	saveAuthSession,
	saveNamedSession,
} from "./session-store";
import type {
	AuthConfig,
	AuthEvent,
	AuthEventType,
	AuthSession,
	DeviceFlowSession,
	MachineId,
	OAuthProvider,
} from "./types";

export type { AuthConfig, AuthEvent, AuthEventType, AuthSession, DeviceFlowSession, MachineId, OAuthProvider };
export {
	DeviceFlowAuth,
	deleteAuthSession,
	deleteNamedSession,
	deviceFlow,
	generateMachineId,
	getMachineFingerprint,
	getMachineId,
	getOAuthProviders,
	handleOAuthCallback,
	hasAuthSession,
	listSavedSessions,
	loadAuthSession,
	refreshAccessToken,
	saveAuthSession,
	saveMachineId,
	saveNamedSession,
	signInWithGithub,
	signOut,
};

const AUTH_EVENTS: AuthEvent[] = [];
const MAX_EVENTS = 100;

function emitAuthEvent(type: AuthEventType, userId?: string, metadata?: Record<string, unknown>): void {
	const event: AuthEvent = { type, userId, timestamp: new Date().toISOString(), metadata };
	AUTH_EVENTS.push(event);
	if (AUTH_EVENTS.length > MAX_EVENTS) AUTH_EVENTS.shift();
}

export function getAuthEvents(): AuthEvent[] {
	return [...AUTH_EVENTS];
}

export function getCurrentSession(): AuthSession | null {
	return loadAuthSession();
}

export function isAuthenticated(): boolean {
	return hasAuthSession();
}

export function getUserTier(): "free" | "pro" | "unknown" {
	const session = loadAuthSession();
	if (!session) return "unknown";
	return session.tier;
}

export function isProUser(): boolean {
	return getUserTier() === "pro";
}

export function hasEnoughCredits(requiredAmount = 0): boolean {
	const session = loadAuthSession();
	if (!session) return false;
	if (session.tier === "pro") return true;
	return session.creditsRemaining > requiredAmount;
}

export function deductCredits(amount: number): void {
	const session = loadAuthSession();
	if (!session || session.tier === "pro") return;
	session.creditsRemaining = Math.max(0, session.creditsRemaining - amount);
	session.lastChecked = new Date().toISOString();
	saveAuthSession(session);
}

export function setUserTier(tier: "free" | "pro"): void {
	const session = loadAuthSession();
	if (!session) return;
	const oldTier = session.tier;
	session.tier = tier;
	if (tier === "pro") session.creditsRemaining = Infinity;
	session.lastChecked = new Date().toISOString();
	saveAuthSession(session);
	emitAuthEvent("tier-change", session.userId, { from: oldTier, to: tier });
	logger.info("User tier updated", { userId: session.userId, tier });
}

export function getDefaultAuthConfig(): AuthConfig {
	return {
		webUrl: process.env.PAKALON_WEB_URL ?? "https://pakalon.dev",
		apiUrl: process.env.PAKALON_API_URL ?? "https://api.pakalon.dev",
		supabaseUrl: process.env.PAKALON_SUPABASE_URL,
		supabaseAnonKey: process.env.PAKALON_SUPABASE_ANON_KEY,
	};
}

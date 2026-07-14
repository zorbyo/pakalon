/**
 * Types for the Pakalon Authentication package.
 */

export interface DeviceFlowSession {
	code: string;
	verificationUri: string;
	expiresIn: number;
	interval: number;
	deviceCode: string;
	startedAt: string;
}

export interface AuthSession {
	userId: string;
	email?: string;
	tier: "free" | "pro";
	creditsRemaining: number;
	accessToken?: string;
	refreshToken?: string;
	provider?: "github" | "google" | "device";
	lastChecked: string;
}

export interface MachineId {
	id: string;
	hostname: string;
	platform: string;
	createdAt: string;
}

export interface OAuthProvider {
	id: string;
	name: string;
	description: string;
	enabled: boolean;
}

export interface AuthConfig {
	webUrl: string;
	apiUrl: string;
	supabaseUrl?: string;
	supabaseAnonKey?: string;
}

export type UserTier = "free" | "pro";

export interface UserProfile {
	tier: UserTier;
	creditsRemaining: number;
	creditsUsed: number;
	featureAccess: string[];
	isPro: boolean;
}

export type AuthEventType = "login" | "logout" | "token-refresh" | "tier-change" | "session-expired";

export interface AuthEvent {
	type: AuthEventType;
	userId?: string;
	timestamp: string;
	metadata?: Record<string, unknown>;
}

/**
 * OAuth type definitions for GitHub and Google OAuth2 flows.
 */

export type SubscriptionType = 'free' | 'pro' | 'team' | 'enterprise' | 'max';

export type RateLimitTier = string | null;

export interface OAuthTokenAccount {
  uuid: string;
  emailAddress: string;
  organizationUuid?: string;
}

export interface OAuthProfile {
  sub?: string;
  id?: string;
  email?: string;
  name?: string;
  picture?: string;
  display_name?: string;
  created_at?: string;
  organization?: {
    uuid?: string;
    organization_type?: string;
    rate_limit_tier?: string;
    has_extra_usage_enabled?: boolean;
    billing_type?: string;
    subscription_created_at?: string;
    organization_name?: string;
    organization_role?: string;
    workspace_role?: string;
  };
  account?: {
    uuid?: string;
    email?: string;
    display_name?: string;
    created_at?: string;
  };
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: number | null;
  scopes: string[];
  subscriptionType: SubscriptionType | null;
  rateLimitTier: RateLimitTier;
  profile?: OAuthProfile;
  tokenAccount?: OAuthTokenAccount;
}

export interface OAuthTokenExchangeResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  account?: {
    uuid: string;
    email_address: string;
  };
  organization?: {
    uuid: string;
  };
}

export interface DeviceCodeResult {
  deviceId: string;
  code: string;
  expiresIn: number;
  loginUrl: string;
  launchExperience: 'video' | 'text';
  isFirstMachineRun: boolean;
}

export interface AuthResult {
  token: string;
  userId: string;
  plan: string;
  githubLogin?: string;
  displayName?: string;
  trialDaysRemaining?: number | null;
  billingDaysRemaining?: number | null;
}

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret?: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  redirectUri: string;
  scopes: string[];
}

export interface OAuthState {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
  redirectUri: string;
  createdAt: number;
  provider: 'github' | 'google';
}

export interface OAuthCallbackResult {
  success: boolean;
  tokens?: OAuthTokens;
  error?: string;
}

export type OAuthProviderType = 'github' | 'google';

export interface AuthUrlOptions {
  codeChallenge: string;
  state: string;
  redirectUri: string;
  scopes?: string[];
  loginHint?: string;
  prompt?: string;
}

export interface TokenRefreshOptions {
  scopes?: string[];
}

export interface StoredOAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  scopes: string[];
  subscriptionType: SubscriptionType | null;
  rateLimitTier: RateLimitTier;
  provider: OAuthProviderType;
  storedAt: string;
}
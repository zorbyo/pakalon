/**
 * Google OAuth2 implementation.
 * Handles Google OAuth authentication flows.
 */
import type {
  OAuthProviderConfig,
  OAuthTokens,
  OAuthState,
  AuthUrlOptions,
} from './oauthTypes.js';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  exchangeCodeForTokens,
  TokenManager,
} from './tokenManager.js';

export const GOOGLE_OAUTH_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
] as const;

export const GOOGLE_OAUTH_CONFIG: Omit<OAuthProviderConfig, 'clientId' | 'redirectUri'> = {
  authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
  scopes: [...GOOGLE_OAUTH_SCOPES],
};

export function createGoogleOAuthConfig(
  clientId: string,
  redirectUri: string,
  clientSecret?: string
): OAuthProviderConfig {
  return {
    ...GOOGLE_OAUTH_CONFIG,
    clientId,
    redirectUri,
    ...(clientSecret ? { clientSecret } : {}),
  };
}

export function buildGoogleAuthUrl(
  config: OAuthProviderConfig,
  options: AuthUrlOptions
): string {
  const url = new URL(config.authorizationUrl);

  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('scope', (options.scopes || config.scopes).join(' '));
  url.searchParams.set('state', options.state);
  url.searchParams.set('code_challenge', options.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');

  if (options.loginHint) {
    url.searchParams.set('login_hint', options.loginHint);
  }

  if (options.prompt) {
    url.searchParams.set('prompt', options.prompt);
  }

  return url.toString();
}

export function createGoogleOAuthState(redirectUri: string): OAuthState {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  return {
    codeVerifier,
    codeChallenge,
    state,
    redirectUri,
    createdAt: Date.now(),
    provider: 'google',
  };
}

export async function handleGoogleCallback(
  config: OAuthProviderConfig,
  code: string,
  state: string,
  expectedState: string,
  codeVerifier: string
): Promise<OAuthTokens> {
  if (state !== expectedState) {
    throw new Error('Invalid state parameter - possible CSRF attack');
  }

  const tokens = await exchangeCodeForTokens(config, code, codeVerifier);
  return tokens;
}

export interface GoogleUserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  locale?: string;
  hd?: string;
}

export async function getGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Google API error: ${response.status}`);
  }

  return response.json();
}

export class GoogleOAuthService {
  private config: OAuthProviderConfig;
  private tokenManager: TokenManager;
  private state: OAuthState | null = null;

  constructor(config: OAuthProviderConfig) {
    this.config = config;
    this.tokenManager = new TokenManager('google', config);
  }

  getAuthorizationUrl(): string {
    this.state = createGoogleOAuthState(this.config.redirectUri);

    return buildGoogleAuthUrl(this.config, {
      codeChallenge: this.state.codeChallenge,
      state: this.state.state,
      redirectUri: this.config.redirectUri,
      scopes: this.config.scopes,
    });
  }

  async handleCallback(code: string): Promise<OAuthTokens> {
    if (!this.state) {
      throw new Error('OAuth state not initialized');
    }

    const tokens = await handleGoogleCallback(
      this.config,
      code,
      this.state.state,
      this.state.state,
      this.state.codeVerifier
    );

    this.tokenManager.setTokens(tokens);
    this.state = null;

    return tokens;
  }

  async getValidTokens(): Promise<OAuthTokens | null> {
    return this.tokenManager.getValidTokens();
  }

  async getUser(): Promise<GoogleUserInfo | null> {
    const tokens = await this.getValidTokens();
    if (!tokens) {
      return null;
    }

    try {
      return await getGoogleUserInfo(tokens.accessToken);
    } catch {
      return null;
    }
  }

  async logout(): Promise<void> {
    this.tokenManager.clearTokens();
    this.state = null;
  }

  isAuthenticated(): boolean {
    return this.tokenManager.isAuthenticated();
  }

  getProvider(): 'google' {
    return 'google';
  }
}

export function createGoogleOAuthService(
  clientId: string,
  redirectUri: string,
  clientSecret?: string
): GoogleOAuthService {
  const config = createGoogleOAuthConfig(clientId, redirectUri, clientSecret);
  return new GoogleOAuthService(config);
}
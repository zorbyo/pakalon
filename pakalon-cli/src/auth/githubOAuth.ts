/**
 * GitHub OAuth2 implementation.
 * Handles GitHub OAuth authentication flows.
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

export const GITHUB_OAUTH_SCOPES = ['user:email', 'read:user'] as const;

export const GITHUB_OAUTH_CONFIG: Omit<OAuthProviderConfig, 'clientId' | 'redirectUri'> = {
  authorizationUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  userInfoUrl: 'https://api.github.com/user',
  scopes: [...GITHUB_OAUTH_SCOPES],
};

export function createGitHubOAuthConfig(
  clientId: string,
  redirectUri: string,
  clientSecret?: string
): OAuthProviderConfig {
  return {
    ...GITHUB_OAUTH_CONFIG,
    clientId,
    redirectUri,
    ...(clientSecret ? { clientSecret } : {}),
  };
}

export function buildGitHubAuthUrl(
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

  if (options.loginHint) {
    url.searchParams.set('login_hint', options.loginHint);
  }

  if (options.prompt) {
    url.searchParams.set('prompt', options.prompt);
  }

  return url.toString();
}

export function createGitHubOAuthState(redirectUri: string): OAuthState {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  return {
    codeVerifier,
    codeChallenge,
    state,
    redirectUri,
    createdAt: Date.now(),
    provider: 'github',
  };
}

export async function handleGitHubCallback(
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

export async function getGitHubUserInfo(
  accessToken: string
): Promise<{
  id: number;
  login: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
}> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Pakalon-CLI',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  return response.json();
}

export async function getGitHubUserEmails(
  accessToken: string
): Promise<Array<{ email: string; primary: boolean; verified: boolean }>> {
  const response = await fetch('https://api.github.com/user/emails', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Pakalon-CLI',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  return response.json();
}

export class GitHubOAuthService {
  private config: OAuthProviderConfig;
  private tokenManager: TokenManager;
  private state: OAuthState | null = null;

  constructor(config: OAuthProviderConfig) {
    this.config = config;
    this.tokenManager = new TokenManager('github', config);
  }

  getAuthorizationUrl(): string {
    this.state = createGitHubOAuthState(this.config.redirectUri);

    return buildGitHubAuthUrl(this.config, {
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

    const tokens = await handleGitHubCallback(
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

  async getUser(): Promise<{
    id: number;
    login: string;
    email: string | null;
    name: string | null;
    avatar_url: string | null;
  } | null> {
    const tokens = await this.getValidTokens();
    if (!tokens) {
      return null;
    }

    try {
      return await getGitHubUserInfo(tokens.accessToken);
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

  getProvider(): 'github' {
    return 'github';
  }
}

export function createGitHubOAuthService(
  clientId: string,
  redirectUri: string,
  clientSecret?: string
): GitHubOAuthService {
  const config = createGitHubOAuthConfig(clientId, redirectUri, clientSecret);
  return new GitHubOAuthService(config);
}
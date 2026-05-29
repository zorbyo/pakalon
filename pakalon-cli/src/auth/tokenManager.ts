/**
 * Token manager for OAuth authentication.
 * Handles token storage, refresh, and validation.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash, randomBytes } from 'crypto';
import type {
  OAuthTokens,
  StoredOAuthTokens,
  OAuthProviderConfig,
  TokenRefreshOptions,
  OAuthProviderType,
} from './oauthTypes.js';

const TOKEN_BUFFER_MS = 5 * 60 * 1000; // 5 minutes before expiry

function getTokenStorageDir(): string {
  const base =
    process.env.PAKALON_CONFIG_DIR ||
    (process.platform === 'win32'
      ? path.join(process.env.APPDATA || os.homedir(), 'pakalon')
      : path.join(os.homedir(), '.config', 'pakalon'));

  return path.join(base, 'oauth');
}

function getTokenPath(provider: OAuthProviderType): string {
  return path.join(getTokenStorageDir(), `${provider}_tokens.json`);
}

function ensureTokenDir(): void {
  const dir = getTokenStorageDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export function saveTokens(tokens: OAuthTokens, provider: OAuthProviderType): void {
  ensureTokenDir();
  const tokenPath = getTokenPath(provider);

  const stored: StoredOAuthTokens = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? null,
    expiresAt: tokens.expiresAt,
    scopes: tokens.scopes,
    subscriptionType: tokens.subscriptionType,
    rateLimitTier: tokens.rateLimitTier,
    provider,
    storedAt: new Date().toISOString(),
  };

  fs.writeFileSync(tokenPath, JSON.stringify(stored, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export function loadTokens(provider: OAuthProviderType): OAuthTokens | null {
  const tokenPath = getTokenPath(provider);

  if (!fs.existsSync(tokenPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(tokenPath, 'utf8');
    const stored: StoredOAuthTokens = JSON.parse(content);

    return {
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken ?? null,
      expiresAt: stored.expiresAt,
      scopes: stored.scopes,
      subscriptionType: stored.subscriptionType,
      rateLimitTier: stored.rateLimitTier,
    };
  } catch {
    return null;
  }
}

export function clearTokens(provider: OAuthProviderType): void {
  const tokenPath = getTokenPath(provider);

  if (fs.existsSync(tokenPath)) {
    fs.unlinkSync(tokenPath);
  }
}

export function isTokenExpired(expiresAt: number | null): boolean {
  if (expiresAt === null) {
    return false;
  }
  return Date.now() + TOKEN_BUFFER_MS >= expiresAt;
}

export function isTokenExpiringSoon(expiresAt: number | null, bufferMs = TOKEN_BUFFER_MS): boolean {
  if (expiresAt === null) {
    return false;
  }
  return Date.now() + bufferMs >= expiresAt;
}

export async function refreshAccessToken(
  config: OAuthProviderConfig,
  refreshToken: string,
  options: TokenRefreshOptions = {}
): Promise<OAuthTokens> {
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.clientId,
      ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
      refresh_token: refreshToken,
      ...(options.scopes?.length
        ? { scope: options.scopes.join(' ') }
        : {}),
    }),
  });

  if (!response.ok) {
    const error = await response.text().catch(() => 'Unknown error');
    throw new Error(`Token refresh failed: ${response.status} - ${error}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
    scopes: parseScopes(data.scope),
    subscriptionType: null,
    rateLimitTier: null,
  };
}

export async function exchangeCodeForTokens(
  config: OAuthProviderConfig,
  code: string,
  codeVerifier: string
): Promise<OAuthTokens> {
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
      code,
      redirect_uri: config.redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const error = await response.text().catch(() => 'Unknown error');
    throw new Error(`Token exchange failed: ${response.status} - ${error}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: Date.now() + data.expires_in * 1000,
    scopes: parseScopes(data.scope),
    subscriptionType: null,
    rateLimitTier: null,
  };
}

function parseScopes(scopeString?: string): string[] {
  return scopeString?.split(' ').filter(Boolean) ?? [];
}

export async function fetchUserInfo(
  config: OAuthProviderConfig,
  accessToken: string
): Promise<Record<string, unknown>> {
  const response = await fetch(config.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user info: ${response.status}`);
  }

  return response.json();
}

export function generateCodeVerifier(): string {
  return base64URLEncode(randomBytes(32));
}

export function generateCodeChallenge(verifier: string): string {
  const hash = createHash('sha256');
  hash.update(verifier);
  return base64URLEncode(hash.digest());
}

export function generateState(): string {
  return base64URLEncode(randomBytes(32));
}

function base64URLEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export class TokenManager {
  private provider: OAuthProviderType;
  private tokens: OAuthTokens | null = null;
  private config: OAuthProviderConfig;
  private refreshPromise: Promise<OAuthTokens> | null = null;

  constructor(provider: OAuthProviderType, config: OAuthProviderConfig) {
    this.provider = provider;
    this.config = config;
  }

  async getValidTokens(): Promise<OAuthTokens | null> {
    if (this.tokens && !isTokenExpired(this.tokens.expiresAt)) {
      return this.tokens;
    }

    if (this.tokens?.refreshToken && isTokenExpired(this.tokens.expiresAt)) {
      return this.refreshTokens();
    }

    const stored = loadTokens(this.provider);
    if (stored && !isTokenExpired(stored.expiresAt)) {
      this.tokens = stored;
      return stored;
    }

    if (stored?.refreshToken && isTokenExpired(stored.expiresAt)) {
      this.tokens = stored;
      return this.refreshTokens();
    }

    return null;
  }

  async refreshTokens(): Promise<OAuthTokens> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    if (!this.tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    this.refreshPromise = this.doRefresh();
    return this.refreshPromise.finally(() => {
      this.refreshPromise = null;
    });
  }

  private async doRefresh(): Promise<OAuthTokens> {
    const newTokens = await refreshAccessToken(this.config, this.tokens!.refreshToken!);
    newTokens.subscriptionType = this.tokens?.subscriptionType ?? null;
    newTokens.rateLimitTier = this.tokens?.rateLimitTier ?? null;
    this.tokens = newTokens;
    saveTokens(newTokens, this.provider);
    return newTokens;
  }

  setTokens(tokens: OAuthTokens): void {
    this.tokens = tokens;
    saveTokens(tokens, this.provider);
  }

  clearTokens(): void {
    this.tokens = null;
    clearTokens(this.provider);
  }

  isAuthenticated(): boolean {
    return this.tokens !== null && !isTokenExpired(this.tokens.expiresAt);
  }

  getProvider(): OAuthProviderType {
    return this.provider;
  }
}
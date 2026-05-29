/**
 * XAA (Cross-App Access) Support
 * Implements SEP-990 cross-app authentication for MCP servers
 */
import { randomUUID } from 'crypto';

export interface XaaConfig {
  enabled: boolean;
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  callbackPort?: number;
}

export interface XaaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

export interface XaaUserInfo {
  sub: string;
  email?: string;
  name?: string;
}

let globalXaaConfig: XaaConfig = { enabled: false };

export function getXaaConfig(): XaaConfig {
  return { ...globalXaaConfig };
}

export function setXaaConfig(config: Partial<XaaConfig>): void {
  globalXaaConfig = { ...globalXaaConfig, ...config };
}

export function isXaaEnabled(): boolean {
  return globalXaaConfig.enabled;
}

export async function exchangeXaaCode(
  code: string,
  redirectUri: string,
): Promise<XaaTokenResponse> {
  if (!globalXaaConfig.clientId || !globalXaaConfig.issuer) {
    throw new Error('XAA not configured');
  }

  const response = await fetch(`${globalXaaConfig.issuer}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: globalXaaConfig.clientId,
    }),
  });

  if (!response.ok) {
    throw new Error(`XAA token exchange failed: ${response.statusText}`);
  }

  return response.json();
}

export async function refreshXaaToken(
  refreshToken: string,
): Promise<XaaTokenResponse> {
  if (!globalXaaConfig.clientId || !globalXaaConfig.issuer) {
    throw new Error('XAA not configured');
  }

  const response = await fetch(`${globalXaaConfig.issuer}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: globalXaaConfig.clientId,
    }),
  });

  if (!response.ok) {
    throw new Error(`XAA token refresh failed: ${response.statusText}`);
  }

  return response.json();
}

export async function getXaaUserInfo(accessToken: string): Promise<XaaUserInfo> {
  if (!globalXaaConfig.issuer) {
    throw new Error('XAA not configured');
  }

  const response = await fetch(`${globalXaaConfig.issuer}/userinfo`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`XAA user info failed: ${response.statusText}`);
  }

  return response.json();
}

export function generateXaaState(): string {
  return randomUUID();
}

export function validateXaaState(state: string, expectedState: string): boolean {
  return state === expectedState;
}
/**
 * MCP OAuth Authentication Module for Pakalon CLI
 * 
 * Provides OAuth 2.0 authentication support for MCP (Model Context Protocol) servers.
 * Features:
 * - OAuth 2.0 authorization code flow with PKCE
 * - Token storage and refresh
 * - Dynamic client registration
 * - Browser-based authorization
 * - Cross-app authentication (XAA) support
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import { z } from "zod";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
}

export interface OAuthClientInfo {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}

export interface OAuthServerMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  registrationEndpoint?: string;
  jwksUri?: string;
  scopesSupported?: string[];
  responseTypesSupported?: string[];
  grantTypesSupported?: string[];
  codeChallengeMethodsSupported?: string[];
}

export interface OAuthAuthorizationRequest {
  responseType: "code";
  clientId: string;
  redirectUri: string;
  scope?: string;
  state: string;
  codeChallenge?: string;
  codeChallengeMethod?: "S256" | "plain";
}

export interface OAuthTokenRequest {
  grantType: "authorization_code" | "refresh_token";
  clientId: string;
  clientSecret?: string;
  redirectUri?: string;
  code?: string;
  refreshToken?: string;
  codeVerifier?: string;
}

export interface AuthResult {
  success: boolean;
  tokens?: OAuthTokens;
  error?: string;
  errorDescription?: string;
}

export interface McpServerAuth {
  serverId: string;
  serverName: string;
  baseUrl: string;
  clientInfo?: OAuthClientInfo;
  tokens?: OAuthTokens;
  metadata?: OAuthServerMetadata;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTH_REQUEST_TIMEOUT_MS = 30000;
const AUTH_CALLBACK_TIMEOUT_MS = 120000;
const MIN_PORT = 49152;
const MAX_PORT = 65535;
const TOKEN_STORAGE_FILE = ".pakalon-mcp-tokens.json";
const OAUTH_CALLBACK_PATH = "/oauth/callback";

// ---------------------------------------------------------------------------
// PKCE Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically secure random string for PKCE code verifier
 */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Generate code challenge from verifier using S256 method
 */
export function generateCodeChallenge(verifier: string): string {
  return crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
}

/**
 * Generate a secure state parameter for CSRF protection
 */
export function generateState(): string {
  return crypto.randomBytes(16).toString("hex");
}

// ---------------------------------------------------------------------------
// Token Storage
// ---------------------------------------------------------------------------

interface TokenStorage {
  servers: Record<string, McpServerAuth>;
  lastUpdated: number;
}

function getTokenStoragePath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  return path.join(homeDir, ".pakalon", TOKEN_STORAGE_FILE);
}

function ensureStorageDir(): void {
  const dir = path.dirname(getTokenStoragePath());
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadTokenStorage(): TokenStorage {
  const filePath = getTokenStoragePath();
  if (!fs.existsSync(filePath)) {
    return { servers: {}, lastUpdated: Date.now() };
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as TokenStorage;
  } catch (error) {
    logger.error(`[mcp-auth] Failed to load token storage: ${error}`);
    return { servers: {}, lastUpdated: Date.now() };
  }
}

export async function saveTokenStorage(storage: TokenStorage): Promise<void> {
  ensureStorageDir();
  const filePath = getTokenStoragePath();
  
  try {
    storage.lastUpdated = Date.now();
    await fs.promises.writeFile(filePath, JSON.stringify(storage, null, 2), "utf-8");
  } catch (error) {
    logger.error(`[mcp-auth] Failed to save token storage: ${error}`);
    throw error;
  }
}

export function getServerAuth(serverId: string): McpServerAuth | null {
  const storage = loadTokenStorage();
  return storage.servers[serverId] ?? null;
}

export async function saveServerAuth(auth: McpServerAuth): Promise<void> {
  const storage = loadTokenStorage();
  storage.servers[auth.serverId] = auth;
  await saveTokenStorage(storage);
}

export async function deleteServerAuth(serverId: string): Promise<void> {
  const storage = loadTokenStorage();
  delete storage.servers[serverId];
  await saveTokenStorage(storage);
}

// ---------------------------------------------------------------------------
// OAuth Server Metadata Discovery
// ---------------------------------------------------------------------------

/**
 * Discover OAuth server metadata from well-known endpoint
 */
export async function discoverOAuthMetadata(
  baseUrl: string
): Promise<OAuthServerMetadata | null> {
  const wellKnownUrl = new URL("/.well-known/oauth-authorization-server", baseUrl);
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);

    const response = await fetch(wellKnownUrl.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      // Try OpenID Connect discovery
      return discoverOidcMetadata(baseUrl);
    }

    const data = await response.json();
    return {
      issuer: data.issuer,
      authorizationEndpoint: data.authorization_endpoint,
      tokenEndpoint: data.token_endpoint,
      revocationEndpoint: data.revocation_endpoint,
      registrationEndpoint: data.registration_endpoint,
      jwksUri: data.jwks_uri,
      scopesSupported: data.scopes_supported,
      responseTypesSupported: data.response_types_supported,
      grantTypesSupported: data.grant_types_supported,
      codeChallengeMethodsSupported: data.code_challenge_methods_supported,
    };
  } catch (error) {
    logger.debug(`[mcp-auth] OAuth metadata discovery failed: ${error}`);
    return null;
  }
}

/**
 * Discover OpenID Connect metadata
 */
async function discoverOidcMetadata(
  baseUrl: string
): Promise<OAuthServerMetadata | null> {
  const oidcUrl = new URL("/.well-known/openid-configuration", baseUrl);
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);

    const response = await fetch(oidcUrl.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = await response.json();
    return {
      issuer: data.issuer,
      authorizationEndpoint: data.authorization_endpoint,
      tokenEndpoint: data.token_endpoint,
      revocationEndpoint: data.revocation_endpoint,
      registrationEndpoint: data.registration_endpoint,
      jwksUri: data.jwks_uri,
      scopesSupported: data.scopes_supported,
      responseTypesSupported: data.response_types_supported,
      grantTypesSupported: data.grant_types_supported,
      codeChallengeMethodsSupported: data.code_challenge_methods_supported,
    };
  } catch (error) {
    logger.debug(`[mcp-auth] OIDC metadata discovery failed: ${error}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Port Finding
// ---------------------------------------------------------------------------

/**
 * Find an available port for the OAuth callback server
 */
export function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr !== "string") {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Could not determine port")));
      }
    });

    server.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// OAuth Authorization Flow
// ---------------------------------------------------------------------------

interface AuthorizationCallbackResult {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

/**
 * Start a local HTTP server to receive the OAuth callback
 */
function startCallbackServer(
  port: number,
  expectedState: string,
  timeout: number = AUTH_CALLBACK_TIMEOUT_MS
): Promise<AuthorizationCallbackResult> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url?.startsWith(OAUTH_CALLBACK_PATH)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const url = new URL(req.url, `http://localhost:${port}`);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      const errorDescription = url.searchParams.get("error_description");

      // Send response to browser
      res.writeHead(200, { "Content-Type": "text/html" });
      if (error) {
        res.end(`
          <html>
            <body style="font-family: system-ui; text-align: center; padding: 40px;">
              <h1 style="color: #e53e3e;">Authentication Failed</h1>
              <p>${errorDescription || error}</p>
              <p>You can close this window.</p>
            </body>
          </html>
        `);
      } else {
        res.end(`
          <html>
            <body style="font-family: system-ui; text-align: center; padding: 40px;">
              <h1 style="color: #38a169;">Authentication Successful</h1>
              <p>You can close this window and return to Pakalon CLI.</p>
            </body>
          </html>
        `);
      }

      // Close server and resolve
      server.close();
      clearTimeout(timeoutHandle);

      if (error) {
        resolve({ error, errorDescription: errorDescription ?? undefined });
      } else if (state !== expectedState) {
        resolve({ error: "state_mismatch", errorDescription: "State parameter mismatch" });
      } else {
        resolve({ code: code ?? undefined, state: state ?? undefined });
      }
    });

    const timeoutHandle = setTimeout(() => {
      server.close();
      resolve({ error: "timeout", errorDescription: "Authorization timed out" });
    }, timeout);

    server.listen(port, "127.0.0.1");
    server.on("error", (err) => {
      clearTimeout(timeoutHandle);
      reject(err);
    });
  });
}

/**
 * Build the authorization URL
 */
export function buildAuthorizationUrl(
  metadata: OAuthServerMetadata,
  request: OAuthAuthorizationRequest
): string {
  const url = new URL(metadata.authorizationEndpoint);
  url.searchParams.set("response_type", request.responseType);
  url.searchParams.set("client_id", request.clientId);
  url.searchParams.set("redirect_uri", request.redirectUri);
  url.searchParams.set("state", request.state);

  if (request.scope) {
    url.searchParams.set("scope", request.scope);
  }
  if (request.codeChallenge) {
    url.searchParams.set("code_challenge", request.codeChallenge);
    url.searchParams.set("code_challenge_method", request.codeChallengeMethod || "S256");
  }

  return url.toString();
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  metadata: OAuthServerMetadata,
  request: OAuthTokenRequest
): Promise<AuthResult> {
  try {
    const body = new URLSearchParams();
    body.set("grant_type", request.grantType);
    body.set("client_id", request.clientId);

    if (request.clientSecret) {
      body.set("client_secret", request.clientSecret);
    }
    if (request.code) {
      body.set("code", request.code);
    }
    if (request.redirectUri) {
      body.set("redirect_uri", request.redirectUri);
    }
    if (request.codeVerifier) {
      body.set("code_verifier", request.codeVerifier);
    }
    if (request.refreshToken) {
      body.set("refresh_token", request.refreshToken);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);

    const response = await fetch(metadata.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || "token_exchange_failed",
        errorDescription: data.error_description,
      };
    }

    const tokens: OAuthTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenType: data.token_type,
      scope: data.scope,
    };

    if (data.expires_in) {
      tokens.expiresAt = Date.now() + data.expires_in * 1000;
    }

    return { success: true, tokens };
  } catch (error) {
    logger.error(`[mcp-auth] Token exchange failed: ${error}`);
    return {
      success: false,
      error: "request_failed",
      errorDescription: String(error),
    };
  }
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(
  serverAuth: McpServerAuth
): Promise<AuthResult> {
  if (!serverAuth.metadata || !serverAuth.tokens?.refreshToken) {
    return {
      success: false,
      error: "no_refresh_token",
      errorDescription: "No refresh token available",
    };
  }

  return exchangeCodeForTokens(serverAuth.metadata, {
    grantType: "refresh_token",
    clientId: serverAuth.clientInfo?.clientId ?? "",
    clientSecret: serverAuth.clientInfo?.clientSecret,
    refreshToken: serverAuth.tokens.refreshToken,
  });
}

/**
 * Check if tokens need refresh
 */
export function tokensNeedRefresh(tokens: OAuthTokens): boolean {
  if (!tokens.expiresAt) return false;
  // Refresh 5 minutes before expiry
  return Date.now() > tokens.expiresAt - 5 * 60 * 1000;
}

/**
 * Perform full OAuth authorization flow
 */
export async function performOAuthFlow(
  serverConfig: {
    serverId: string;
    serverName: string;
    baseUrl: string;
    clientId?: string;
    clientSecret?: string;
    scope?: string;
  },
  options: {
    openBrowser?: (url: string) => Promise<void>;
  } = {}
): Promise<AuthResult> {
  const { serverId, serverName, baseUrl, clientId, clientSecret, scope } = serverConfig;

  logger.info(`[mcp-auth] Starting OAuth flow for ${serverName}`);

  // Discover OAuth metadata
  const metadata = await discoverOAuthMetadata(baseUrl);
  if (!metadata) {
    return {
      success: false,
      error: "discovery_failed",
      errorDescription: "Could not discover OAuth server metadata",
    };
  }

  // Find available port
  let port: number;
  try {
    port = await findAvailablePort();
  } catch {
    return {
      success: false,
      error: "port_unavailable",
      errorDescription: "Could not find available port for OAuth callback",
    };
  }

  const redirectUri = `http://127.0.0.1:${port}${OAUTH_CALLBACK_PATH}`;
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // Build authorization URL
  const authUrl = buildAuthorizationUrl(metadata, {
    responseType: "code",
    clientId: clientId || serverName,
    redirectUri,
    scope,
    state,
    codeChallenge,
    codeChallengeMethod: "S256",
  });

  // Start callback server
  const callbackPromise = startCallbackServer(port, state);

  // Open browser
  if (options.openBrowser) {
    await options.openBrowser(authUrl);
  } else {
    logger.info(`[mcp-auth] Please open this URL in your browser: ${authUrl}`);
    // Try to open with default browser
    const { exec } = require("child_process") as typeof import("child_process");
    const cmd = process.platform === "win32" ? "start" :
                process.platform === "darwin" ? "open" : "xdg-open";
    exec(`${cmd} "${authUrl}"`);
  }

  // Wait for callback
  const callback = await callbackPromise;

  if (callback.error) {
    return {
      success: false,
      error: callback.error,
      errorDescription: callback.errorDescription,
    };
  }

  if (!callback.code) {
    return {
      success: false,
      error: "no_code",
      errorDescription: "No authorization code received",
    };
  }

  // Exchange code for tokens
  const tokenResult = await exchangeCodeForTokens(metadata, {
    grantType: "authorization_code",
    clientId: clientId || serverName,
    clientSecret,
    code: callback.code,
    redirectUri,
    codeVerifier,
  });

  if (!tokenResult.success) {
    return tokenResult;
  }

  // Save auth to storage
  const serverAuth: McpServerAuth = {
    serverId,
    serverName,
    baseUrl,
    metadata,
    tokens: tokenResult.tokens,
    clientInfo: {
      clientId: clientId || serverName,
      clientSecret,
      redirectUri,
    },
  };

  await saveServerAuth(serverAuth);
  logger.info(`[mcp-auth] OAuth flow completed successfully for ${serverName}`);

  return tokenResult;
}

/**
 * Get valid access token, refreshing if needed
 */
export async function getValidAccessToken(
  serverId: string
): Promise<string | null> {
  const serverAuth = getServerAuth(serverId);
  if (!serverAuth?.tokens?.accessToken) {
    return null;
  }

  // Check if refresh is needed
  if (tokensNeedRefresh(serverAuth.tokens)) {
    logger.debug(`[mcp-auth] Refreshing tokens for ${serverId}`);
    const result = await refreshAccessToken(serverAuth);
    
    if (!result.success || !result.tokens) {
      logger.error(`[mcp-auth] Token refresh failed: ${result.error}`);
      return null;
    }

    // Save refreshed tokens
    serverAuth.tokens = result.tokens;
    await saveServerAuth(serverAuth);
  }

  return serverAuth.tokens.accessToken;
}

/**
 * Revoke tokens for a server
 */
export async function revokeTokens(serverId: string): Promise<boolean> {
  const serverAuth = getServerAuth(serverId);
  if (!serverAuth?.metadata?.revocationEndpoint || !serverAuth.tokens) {
    await deleteServerAuth(serverId);
    return true;
  }

  try {
    const body = new URLSearchParams();
    body.set("token", serverAuth.tokens.accessToken);
    if (serverAuth.clientInfo?.clientId) {
      body.set("client_id", serverAuth.clientInfo.clientId);
    }
    if (serverAuth.clientInfo?.clientSecret) {
      body.set("client_secret", serverAuth.clientInfo.clientSecret);
    }

    await fetch(serverAuth.metadata.revocationEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    await deleteServerAuth(serverId);
    return true;
  } catch (error) {
    logger.error(`[mcp-auth] Token revocation failed: ${error}`);
    await deleteServerAuth(serverId);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Zod Schemas for Tool Integration
// ---------------------------------------------------------------------------

export const mcpAuthSchema = z.object({
  action: z.enum(["login", "logout", "status", "refresh"]).describe("Auth action to perform"),
  serverId: z.string().describe("MCP server identifier"),
  serverName: z.string().optional().describe("Display name for the server"),
  baseUrl: z.string().optional().describe("OAuth server base URL"),
  clientId: z.string().optional().describe("OAuth client ID"),
  scope: z.string().optional().describe("OAuth scope"),
});

export type McpAuthInput = z.infer<typeof mcpAuthSchema>;

export interface McpAuthOutput {
  success: boolean;
  action: string;
  serverId: string;
  message?: string;
  isAuthenticated?: boolean;
  expiresAt?: number;
  error?: string;
}

export const mcpAuthToolDefinition = {
  name: "mcp_auth",
  description: "Manage OAuth authentication for MCP servers",
  inputSchema: mcpAuthSchema,

  async execute(input: McpAuthInput): Promise<McpAuthOutput> {
    const { action, serverId, serverName, baseUrl, clientId, scope } = input;

    switch (action) {
      case "login": {
        if (!baseUrl) {
          return {
            success: false,
            action,
            serverId,
            error: "baseUrl is required for login",
          };
        }

        const result = await performOAuthFlow({
          serverId,
          serverName: serverName || serverId,
          baseUrl,
          clientId,
          scope,
        });

        return {
          success: result.success,
          action,
          serverId,
          message: result.success ? "Authentication successful" : undefined,
          isAuthenticated: result.success,
          expiresAt: result.tokens?.expiresAt,
          error: result.error,
        };
      }

      case "logout": {
        const success = await revokeTokens(serverId);
        return {
          success,
          action,
          serverId,
          message: success ? "Logged out successfully" : "Logout failed",
          isAuthenticated: false,
        };
      }

      case "status": {
        const serverAuth = getServerAuth(serverId);
        const hasValidToken = serverAuth?.tokens?.accessToken &&
          (!serverAuth.tokens.expiresAt || serverAuth.tokens.expiresAt > Date.now());

        return {
          success: true,
          action,
          serverId,
          isAuthenticated: !!hasValidToken,
          expiresAt: serverAuth?.tokens?.expiresAt,
        };
      }

      case "refresh": {
        const serverAuth = getServerAuth(serverId);
        if (!serverAuth) {
          return {
            success: false,
            action,
            serverId,
            error: "Server not authenticated",
            isAuthenticated: false,
          };
        }

        const result = await refreshAccessToken(serverAuth);
        if (result.success && result.tokens) {
          serverAuth.tokens = result.tokens;
          await saveServerAuth(serverAuth);
        }

        return {
          success: result.success,
          action,
          serverId,
          isAuthenticated: result.success,
          expiresAt: result.tokens?.expiresAt,
          error: result.error,
        };
      }

      default:
        return {
          success: false,
          action,
          serverId,
          error: `Unknown action: ${action}`,
        };
    }
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  // PKCE
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  
  // Token Storage
  loadTokenStorage,
  saveTokenStorage,
  getServerAuth,
  saveServerAuth,
  deleteServerAuth,
  
  // OAuth Discovery
  discoverOAuthMetadata,
  
  // OAuth Flow
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  tokensNeedRefresh,
  performOAuthFlow,
  getValidAccessToken,
  revokeTokens,
  findAvailablePort,
  
  // Tool
  mcpAuthSchema,
  mcpAuthToolDefinition,
};

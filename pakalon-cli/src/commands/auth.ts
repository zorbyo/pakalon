/**
 * Auth Commands for Pakalon CLI
 * 
 * Login/logout and authentication management.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as http from "http";
import * as crypto from "crypto";
import type { CommandContext, CommandResult } from "./types.js";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType: string;
  scope?: string[];
}

export interface UserInfo {
  id: string;
  email?: string;
  name?: string;
  avatar?: string;
  plan?: string;
  organizations?: string[];
}

export interface AuthState {
  token?: AuthToken;
  user?: UserInfo;
  provider: string;
  authenticatedAt?: number;
  expiresAt?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTH_FILE = path.join(os.homedir(), ".pakalon", "auth.json");
const TOKEN_FILE = path.join(os.homedir(), ".pakalon", "tokens.json");

const OAUTH_CONFIG = {
  github: {
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userUrl: "https://api.github.com/user",
    clientId: process.env.GITHUB_CLIENT_ID ?? "pakalon-cli",
    scope: ["read:user", "user:email"],
  },
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    scope: ["email", "profile"],
  },
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentAuth: AuthState | null = null;

// ---------------------------------------------------------------------------
// Token Storage
// ---------------------------------------------------------------------------

async function ensureAuthDir(): Promise<void> {
  const dir = path.dirname(AUTH_FILE);
  await fs.mkdir(dir, { recursive: true });
}

export async function saveAuthState(state: AuthState): Promise<void> {
  await ensureAuthDir();
  await fs.writeFile(AUTH_FILE, JSON.stringify(state, null, 2), "utf-8");
  
  // Store tokens separately with more restrictive permissions
  if (state.token) {
    await fs.writeFile(TOKEN_FILE, JSON.stringify(state.token, null, 2), {
      encoding: "utf-8",
      mode: 0o600, // Owner read/write only
    });
  }
  
  currentAuth = state;
  logger.debug("[auth] Auth state saved");
}

export async function loadAuthState(): Promise<AuthState | null> {
  try {
    const data = await fs.readFile(AUTH_FILE, "utf-8");
    const state = JSON.parse(data) as AuthState;
    
    // Check expiration
    if (state.expiresAt && state.expiresAt < Date.now()) {
      logger.debug("[auth] Auth token expired");
      return null;
    }
    
    currentAuth = state;
    return state;
  } catch (error) {
    // File doesn't exist or is invalid
    return null;
  }
}

export async function clearAuthState(): Promise<void> {
  try {
    await fs.unlink(AUTH_FILE);
    await fs.unlink(TOKEN_FILE).catch(() => {});
    currentAuth = null;
    logger.debug("[auth] Auth state cleared");
  } catch {
    // Ignore errors
  }
}

export function getCurrentAuth(): AuthState | null {
  return currentAuth;
}

export function isAuthenticated(): boolean {
  if (!currentAuth?.token) return false;
  if (currentAuth.expiresAt && currentAuth.expiresAt < Date.now()) return false;
  return true;
}

// ---------------------------------------------------------------------------
// OAuth Flow
// ---------------------------------------------------------------------------

interface OAuthCallbackResult {
  code?: string;
  state?: string;
  error?: string;
}

async function startOAuthServer(
  port: number = 0
): Promise<{ url: string; waitForCallback: () => Promise<OAuthCallbackResult>; close: () => void }> {
  return new Promise((resolve) => {
    let callbackResolve: (result: OAuthCallbackResult) => void;
    const callbackPromise = new Promise<OAuthCallbackResult>((res) => {
      callbackResolve = res;
    });

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      
      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code") ?? undefined;
        const state = url.searchParams.get("state") ?? undefined;
        const error = url.searchParams.get("error") ?? undefined;

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <html>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
              <h1>${error ? "[X] Authentication Failed" : "[OK] Authentication Successful"}</h1>
              <p>${error ?? "You can close this window and return to the CLI."}</p>
              <script>setTimeout(() => window.close(), 2000);</script>
            </body>
          </html>
        `);

        callbackResolve!({ code, state, error });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      const url = `http://127.0.0.1:${actualPort}/callback`;

      resolve({
        url,
        waitForCallback: () => callbackPromise,
        close: () => server.close(),
      });
    });
  });
}

async function exchangeCodeForToken(
  provider: string,
  code: string,
  redirectUri: string
): Promise<AuthToken> {
  const config = OAUTH_CONFIG[provider as keyof typeof OAUTH_CONFIG];
  if (!config) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`);
  }

  const data = await response.json() as Record<string, unknown>;

  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string | undefined,
    expiresAt: data.expires_in
      ? Date.now() + (data.expires_in as number) * 1000
      : undefined,
    tokenType: (data.token_type as string) ?? "Bearer",
    scope: typeof data.scope === "string" ? data.scope.split(" ") : undefined,
  };
}

async function fetchUserInfo(
  provider: string,
  accessToken: string
): Promise<UserInfo> {
  const config = OAUTH_CONFIG[provider as keyof typeof OAUTH_CONFIG];
  if (!config) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const response = await fetch(config.userUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user info: ${response.status}`);
  }

  const data = await response.json() as Record<string, unknown>;

  // Normalize user info across providers
  return {
    id: String(data.id ?? data.sub ?? ""),
    email: data.email as string | undefined,
    name: (data.name ?? data.login) as string | undefined,
    avatar: (data.avatar_url ?? data.picture) as string | undefined,
    plan: data.plan as string | undefined,
  };
}

// ---------------------------------------------------------------------------
// Command Implementations
// ---------------------------------------------------------------------------

export const loginCommand = {
  name: "login",
  aliases: ["signin", "auth"],
  description: "Log in to your account",
  usage: "/login [--provider github|google] [--token <api_key>]",
  category: "auth" as const,

  async execute(context: CommandContext, args: string[]): Promise<CommandResult> {
    // Check if already logged in
    const existing = await loadAuthState();
    if (existing?.token) {
      return {
        success: true,
        message: `Already logged in as ${existing.user?.name ?? existing.user?.email ?? "user"}`,
      };
    }

    // Parse arguments
    let provider = "github";
    let apiToken: string | undefined;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === "--provider" || arg === "-p") {
        provider = args[++i] ?? "github";
      } else if (arg === "--token" || arg === "-t") {
        apiToken = args[++i];
      }
    }

    // API token login (for CI/CD)
    if (apiToken) {
      const state: AuthState = {
        token: {
          accessToken: apiToken,
          tokenType: "Bearer",
        },
        provider: "api_key",
        authenticatedAt: Date.now(),
      };

      await saveAuthState(state);

      return {
        success: true,
        message: "Logged in with API token",
      };
    }

    // OAuth flow
    const config = OAUTH_CONFIG[provider as keyof typeof OAUTH_CONFIG];
    if (!config) {
      return {
        success: false,
        message: `Unknown provider: ${provider}. Use 'github' or 'google'.`,
      };
    }

    logger.info(`[auth] Starting OAuth flow with ${provider}`);

    // Start local callback server
    const server = await startOAuthServer();
    const state = crypto.randomBytes(16).toString("hex");

    // Build auth URL
    const authUrl = new URL(config.authUrl);
    authUrl.searchParams.set("client_id", config.clientId);
    authUrl.searchParams.set("redirect_uri", server.url);
    authUrl.searchParams.set("scope", config.scope.join(" "));
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("response_type", "code");

    // Open browser
    console.log(`\nOpening browser for authentication...`);
    console.log(`If browser doesn't open, visit: ${authUrl.toString()}\n`);

    try {
      const { exec } = require("child_process") as typeof import("child_process");
      const cmd = process.platform === "win32"
        ? `start "" "${authUrl.toString()}"`
        : process.platform === "darwin"
        ? `open "${authUrl.toString()}"`
        : `xdg-open "${authUrl.toString()}"`;
      
      exec(cmd);
    } catch (error) {
      logger.warn(`[auth] Failed to open browser: ${error}`);
    }

    // Wait for callback
    console.log("Waiting for authentication...");
    const callback = await server.waitForCallback();
    server.close();

    if (callback.error || !callback.code) {
      return {
        success: false,
        message: `Authentication failed: ${callback.error ?? "No code received"}`,
      };
    }

    if (callback.state !== state) {
      return {
        success: false,
        message: "Authentication failed: State mismatch (possible CSRF)",
      };
    }

    // Exchange code for token
    try {
      const token = await exchangeCodeForToken(provider, callback.code, server.url);
      const user = await fetchUserInfo(provider, token.accessToken);

      const authState: AuthState = {
        token,
        user,
        provider,
        authenticatedAt: Date.now(),
        expiresAt: token.expiresAt,
      };

      await saveAuthState(authState);

      return {
        success: true,
        message: `Successfully logged in as ${user.name ?? user.email ?? "user"}`,
        data: { user },
      };
    } catch (error) {
      return {
        success: false,
        message: `Authentication failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

export const logoutCommand = {
  name: "logout",
  aliases: ["signout"],
  description: "Log out of your account",
  usage: "/logout",
  category: "auth" as const,

  async execute(context: CommandContext, args: string[]): Promise<CommandResult> {
    const auth = await loadAuthState();

    if (!auth?.token) {
      return {
        success: true,
        message: "Not currently logged in",
      };
    }

    await clearAuthState();

    return {
      success: true,
      message: `Logged out${auth.user?.name ? ` (was: ${auth.user.name})` : ""}`,
    };
  },
};

export const whoamiCommand = {
  name: "whoami",
  aliases: ["me"],
  description: "Show current user info",
  usage: "/whoami",
  category: "auth" as const,

  async execute(context: CommandContext, args: string[]): Promise<CommandResult> {
    const auth = await loadAuthState();

    if (!auth?.token) {
      return {
        success: true,
        message: "Not logged in",
      };
    }

    const lines: string[] = [];
    lines.push("[User] Current User");
    lines.push("═".repeat(30));

    if (auth.user) {
      if (auth.user.name) lines.push(`Name: ${auth.user.name}`);
      if (auth.user.email) lines.push(`Email: ${auth.user.email}`);
      if (auth.user.plan) lines.push(`Plan: ${auth.user.plan}`);
      if (auth.user.organizations?.length) {
        lines.push(`Orgs: ${auth.user.organizations.join(", ")}`);
      }
    }

    lines.push(`Provider: ${auth.provider}`);
    
    if (auth.authenticatedAt) {
      const date = new Date(auth.authenticatedAt).toLocaleString();
      lines.push(`Logged in: ${date}`);
    }

    if (auth.expiresAt) {
      const remaining = auth.expiresAt - Date.now();
      if (remaining > 0) {
        const hours = Math.floor(remaining / 3600000);
        lines.push(`Expires in: ${hours}h`);
      } else {
        lines.push("Warning: Token expired");
      }
    }

    return {
      success: true,
      message: lines.join("\n"),
      data: { user: auth.user },
    };
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  loginCommand,
  logoutCommand,
  whoamiCommand,
  saveAuthState,
  loadAuthState,
  clearAuthState,
  getCurrentAuth,
  isAuthenticated,
};

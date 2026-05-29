/**
 * OAuth service implementation supporting GitHub and Google OAuth2 flows.
 * Provides unified interface for OAuth authentication with PKCE support.
 */
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { execFile } from 'child_process';
import type {
  OAuthProviderType,
  OAuthTokens,
  OAuthCallbackResult,
  AuthUrlOptions,
} from './oauthTypes.js';
import { TokenManager } from './tokenManager.js';
import {
  createGitHubOAuthService,
  type GitHubOAuthService,
} from './githubOAuth.js';
import {
  createGoogleOAuthService,
  type GoogleOAuthService,
} from './googleOAuth.js';

const DEFAULT_PORT = 38475;
const CALLBACK_PATH = '/callback';
const TOKEN_EXCHANGE_TIMEOUT_MS = 15000;
const AUTH_SERVER_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export interface OAuthServiceConfig {
  github: {
    clientId: string;
    clientSecret?: string;
  };
  google: {
    clientId: string;
    clientSecret?: string;
  };
  defaultRedirectUri: string;
}

export interface StartOAuthFlowOptions {
  provider: OAuthProviderType;
  redirectUri?: string;
  loginHint?: string;
  prompt?: string;
  skipBrowserOpen?: boolean;
}

export interface AuthCodeListenerResult {
  code: string;
  state: string;
}

class AuthCodeListener {
  private server: Server | null = null;
  private port: number = 0;
  private resolveCallback: ((result: AuthCodeListenerResult) => void) | null = null;
  private rejectCallback: ((error: Error) => void) | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private callbackPath: string;

  constructor(callbackPath: string = CALLBACK_PATH) {
    this.callbackPath = callbackPath;
  }

  async start(preferredPort?: number): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = createServer();

      this.server.on('error', (err) => {
        reject(new Error(`Failed to start OAuth callback server: ${err.message}`));
      });

      this.server.listen(preferredPort ?? 0, 'localhost', () => {
        const address = this.server!.address() as AddressInfo;
        this.port = address.port;
        resolve(this.port);
      });
    });
  }

  async waitForAuthorization(state: string): Promise<AuthCodeListenerResult> {
    return new Promise((resolve, reject) => {
      this.resolveCallback = resolve;
      this.rejectCallback = reject;

      this.timeout = setTimeout(() => {
        reject(new Error('OAuth authorization timed out'));
      }, AUTH_SERVER_TIMEOUT_MS);

      this.server?.on('request', this.handleRequest.bind(this));
    });
  }

  private handleRequest(req: import('http').IncomingMessage, res: import('http').ServerResponse): void {
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname !== this.callbackPath) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const code = url.searchParams.get('code') ?? undefined;
    const state = url.searchParams.get('state') ?? undefined;
    const error = url.searchParams.get('error');

    if (error) {
      res.writeHead(400);
      res.end(`OAuth error: ${error}`);
      this.rejectCallback?.(new Error(`OAuth error: ${error}`));
      return;
    }

    if (!code || !state) {
      res.writeHead(400);
      res.end('Missing authorization code or state');
      this.rejectCallback?.(new Error('Missing authorization code or state'));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h2>Authentication Successful</h2>
          <p>You can close this window and return to the application.</p>
        </body>
      </html>
    `);

    this.resolveCallback?.({ code, state });
  }

  close(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }

    if (this.server) {
      this.server.close();
      this.server = null;
    }

    this.resolveCallback = null;
    this.rejectCallback = null;
  }

  getPort(): number {
    return this.port;
  }
}

export class OAuthService {
  private config: OAuthServiceConfig;
  private githubService: GitHubOAuthService;
  private googleService: GoogleOAuthService;
  private authCodeListener: AuthCodeListener | null = null;

  constructor(config: OAuthServiceConfig) {
    this.config = config;
    this.githubService = createGitHubOAuthService(
      config.github.clientId,
      config.defaultRedirectUri,
      config.github.clientSecret
    );
    this.googleService = createGoogleOAuthService(
      config.google.clientId,
      config.defaultRedirectUri,
      config.google.clientSecret
    );
  }

  getAuthorizationUrl(options: StartOAuthFlowOptions): string {
    const service = this.getService(options.provider);

    if (options.redirectUri) {
      return options.provider === 'github'
        ? createGitHubOAuthService(
            this.config.github.clientId,
            options.redirectUri,
            this.config.github.clientSecret
          ).getAuthorizationUrl()
        : createGoogleOAuthService(
            this.config.google.clientId,
            options.redirectUri,
            this.config.google.clientSecret
          ).getAuthorizationUrl();
    }

    return service.getAuthorizationUrl();
  }

  async startOAuthFlow(
    options: StartOAuthFlowOptions,
    authUrlHandler?: (url: string, manualUrl?: string) => Promise<void>
  ): Promise<OAuthCallbackResult> {
    this.authCodeListener = new AuthCodeListener();
    const port = await this.authCodeListener.start(DEFAULT_PORT);

    const service = this.getService(options.provider);
    let authUrl: string;

    if (options.redirectUri) {
      const serviceWithCustomUri =
        options.provider === 'github'
          ? createGitHubOAuthService(
              this.config.github.clientId,
              options.redirectUri,
              this.config.github.clientSecret
            )
          : createGoogleOAuthService(
              this.config.google.clientId,
              options.redirectUri,
              this.config.google.clientSecret
            );
      authUrl = serviceWithCustomUri.getAuthorizationUrl();
    } else {
      authUrl = service.getAuthorizationUrl();
    }

    try {
      if (authUrlHandler) {
        await authUrlHandler(authUrl);
      } else {
        await this.openBrowser(authUrl);
      }

      const result = await this.authCodeListener.waitForAuthorization('');

      const tokens = await service.handleCallback(result.code);

      return { success: true, tokens };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'OAuth flow failed',
      };
    } finally {
      this.authCodeListener.close();
      this.authCodeListener = null;
    }
  }

  async handleCallback(
    provider: OAuthProviderType,
    code: string,
    state: string
  ): Promise<OAuthCallbackResult> {
    try {
      const service = this.getService(provider);
      const tokens = await service.handleCallback(code);
      return { success: true, tokens };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Callback handling failed',
      };
    }
  }

  async getValidTokens(provider: OAuthProviderType): Promise<OAuthTokens | null> {
    const service = this.getService(provider);
    return service.getValidTokens();
  }

  async logout(provider?: OAuthProviderType): Promise<void> {
    if (provider) {
      const service = this.getService(provider);
      await service.logout();
    } else {
      await this.githubService.logout();
      await this.googleService.logout();
    }
  }

  isAuthenticated(provider?: OAuthProviderType): boolean {
    if (provider) {
      return this.getService(provider).isAuthenticated();
    }
    return this.githubService.isAuthenticated() || this.googleService.isAuthenticated();
  }

  getProviderService(provider: OAuthProviderType): GitHubOAuthService | GoogleOAuthService {
    return this.getService(provider);
  }

  private getService(
    provider: OAuthProviderType
  ): GitHubOAuthService | GoogleOAuthService {
    switch (provider) {
      case 'github':
        return this.githubService;
      case 'google':
        return this.googleService;
      default:
        throw new Error(`Unknown OAuth provider: ${provider}`);
    }
  }

  private async openBrowser(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const done = (error: Error | null) => {
        if (error) reject(error);
        else resolve();
      };

      if (process.platform === 'win32') {
        execFile('cmd', ['/c', 'start', '', url], (error) => done(error));
        return;
      }

      if (process.platform === 'darwin') {
        execFile('open', [url], (error) => done(error));
        return;
      }

      execFile('xdg-open', [url], (error) => done(error));
    });
  }

  cleanup(): void {
    this.authCodeListener?.close();
    this.authCodeListener = null;
  }
}

export function createOAuthService(config: OAuthServiceConfig): OAuthService {
  return new OAuthService(config);
}

export { TokenManager } from './tokenManager.js';
export {
  createGitHubOAuthService,
  createGoogleOAuthService,
  buildGitHubAuthUrl,
  buildGoogleAuthUrl,
} from './githubOAuth.js';
export {
  createGoogleOAuthService,
  buildGoogleAuthUrl,
  buildGoogleAuthUrl as buildGoogleOAuthAuthUrl,
} from './googleOAuth.js';
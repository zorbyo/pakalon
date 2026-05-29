/**
 * OAuth service — orchestrates the OAuth 2.0 authorization code flow with PKCE.
 *
 * Supports two ways to get authorization codes:
 * 1. Automatic: Opens browser, redirects to localhost where we capture the code
 * 2. Manual: User manually copies and pastes the code (non-browser environments)
 */
import { logEvent } from '../analytics/index.js'
import { openBrowser } from '../../utils/browser.js'
import { AuthCodeListener } from './auth-code-listener.js'
import * as client from './client.js'
import * as crypto from './crypto.js'

export interface OAuthFlowOptions {
  loginWithClaudeAi?: boolean
  inferenceOnly?: boolean
  orgUUID?: string
  loginHint?: string
  loginMethod?: string
  skipBrowserOpen?: boolean
  expiresIn?: number
}

export interface OAuthResult extends client.OAuthTokens {}

export class OAuthService {
  private codeVerifier: string
  private authCodeListener: AuthCodeListener | null = null
  private port: number | null = null
  private manualAuthCodeResolver: ((code: string) => void) | null = null

  constructor() {
    this.codeVerifier = crypto.generateCodeVerifier()
  }

  async startOAuthFlow(
    authURLHandler: (manualUrl: string, automaticUrl?: string) => Promise<void>,
    options?: OAuthFlowOptions
  ): Promise<OAuthResult> {
    this.authCodeListener = new AuthCodeListener()
    this.port = await this.authCodeListener.start()

    const codeChallenge = crypto.generateCodeChallenge(this.codeVerifier)
    const state = crypto.generateState()

    const buildOpts = {
      codeChallenge,
      state,
      port: this.port,
      loginWithClaudeAi: options?.loginWithClaudeAi,
      inferenceOnly: options?.inferenceOnly,
      orgUUID: options?.orgUUID,
      loginHint: options?.loginHint,
      loginMethod: options?.loginMethod,
    }

    const manualFlowUrl = client.buildAuthUrl({ ...buildOpts, isManual: true })
    const automaticFlowUrl = client.buildAuthUrl({ ...buildOpts, isManual: false })

    const authorizationCode = await this.waitForAuthorizationCode(state, async () => {
      if (options?.skipBrowserOpen) {
        await authURLHandler(manualFlowUrl, automaticFlowUrl)
      } else {
        await authURLHandler(manualFlowUrl)
        await openBrowser(automaticFlowUrl)
      }
    })

    const isAutomaticFlow = this.authCodeListener?.hasPendingResponse() ?? false
    logEvent('tengu_oauth_auth_code_received', { automatic: isAutomaticFlow })

    try {
      const tokenResponse = await client.exchangeCodeForTokens(
        authorizationCode,
        state,
        this.codeVerifier,
        this.port!,
        !isAutomaticFlow,
        options?.expiresIn
      )

      const profileInfo = await client.fetchProfileInfo(tokenResponse.access_token)

      if (isAutomaticFlow) {
        const scopes = client.parseScopes(tokenResponse.scope)
        this.authCodeListener?.handleSuccessRedirect(scopes)
      }

      return this.formatTokens(
        tokenResponse,
        profileInfo.subscriptionType,
        profileInfo.rateLimitTier,
        profileInfo.rawProfile
      )
    } catch (error) {
      if (isAutomaticFlow) {
        this.authCodeListener?.handleErrorRedirect()
      }
      throw error
    } finally {
      this.authCodeListener?.close()
    }
  }

  private async waitForAuthorizationCode(
    state: string,
    onReady: () => Promise<void>
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      this.manualAuthCodeResolver = resolve

      this.authCodeListener
        ?.waitForAuthorization(state, onReady)
        .then(authorizationCode => {
          this.manualAuthCodeResolver = null
          resolve(authorizationCode)
        })
        .catch(error => {
          this.manualAuthCodeResolver = null
          reject(error)
        })
    })
  }

  handleManualAuthCodeInput(authorizationCode: string): void {
    if (this.manualAuthCodeResolver) {
      this.manualAuthCodeResolver(authorizationCode)
      this.manualAuthCodeResolver = null
      this.authCodeListener?.close()
    }
  }

  private formatTokens(
    response: client.TokenExchangeResponse,
    subscriptionType: string | null,
    rateLimitTier: string | null,
    profile: unknown
  ): OAuthResult {
    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresAt: Date.now() + response.expires_in * 1000,
      scopes: client.parseScopes(response.scope),
      subscriptionType,
      rateLimitTier,
      profile,
      tokenAccount: response.account
        ? {
            uuid: response.account.uuid,
            emailAddress: response.account.email_address,
            organizationUuid: response.organization?.uuid,
          }
        : undefined,
    }
  }

  cleanup(): void {
    this.authCodeListener?.close()
    this.manualAuthCodeResolver = null
  }
}

export { AuthCodeListener }
export * from './client.js'
export * from './crypto.js'
export * from './getOauthProfile.js'

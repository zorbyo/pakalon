/**
 * OAuth client — token exchange, refresh, and profile management.
 */
import axios from 'axios'
import {
  ALL_OAUTH_SCOPES,
  CLAUDE_AI_INFERENCE_SCOPE,
  CLAUDE_AI_OAUTH_SCOPES,
  getOauthConfig,
} from '../../constants/oauth.js'
import { logEvent } from '../analytics/index.js'

export interface TokenAccount {
  uuid: string
  emailAddress: string
  organizationUuid: string | undefined
}

export interface OAuthTokens {
  accessToken: string
  refreshToken: string | undefined
  expiresAt: number
  scopes: string[]
  subscriptionType: string | null
  rateLimitTier: string | null
  profile: unknown
  tokenAccount: TokenAccount | undefined
}

export interface ProfileInfo {
  subscriptionType: string | null
  rateLimitTier: string | null
  hasExtraUsageEnabled: boolean | null
  billingType: string | null
  displayName?: string
  accountCreatedAt?: string
  subscriptionCreatedAt?: string
  rawProfile: unknown
}

export function shouldUseClaudeAIAuth(scopes: string[] | undefined): boolean {
  return Boolean(scopes?.includes(CLAUDE_AI_INFERENCE_SCOPE))
}

export function parseScopes(scopeString: string | undefined): string[] {
  return scopeString?.split(' ').filter(Boolean) ?? []
}

export interface BuildAuthUrlOptions {
  codeChallenge: string
  state: string
  port: number
  isManual: boolean
  loginWithClaudeAi?: boolean
  inferenceOnly?: boolean
  orgUUID?: string
  loginHint?: string
  loginMethod?: string
}

export function buildAuthUrl(options: BuildAuthUrlOptions): string {
  const {
    codeChallenge,
    state,
    port,
    isManual,
    loginWithClaudeAi,
    inferenceOnly,
    orgUUID,
    loginHint,
    loginMethod,
  } = options

  const config = getOauthConfig()
  const authUrlBase = loginWithClaudeAi
    ? config.CLAUDE_AI_AUTHORIZE_URL
    : config.CONSOLE_AUTHORIZE_URL

  const authUrl = new URL(authUrlBase)
  authUrl.searchParams.append('code', 'true')
  authUrl.searchParams.append('client_id', config.CLIENT_ID)
  authUrl.searchParams.append('response_type', 'code')
  authUrl.searchParams.append(
    'redirect_uri',
    isManual
      ? config.MANUAL_REDIRECT_URL
      : `http://localhost:${port}/callback`
  )

  const scopesToUse = inferenceOnly
    ? [CLAUDE_AI_INFERENCE_SCOPE]
    : ALL_OAUTH_SCOPES

  authUrl.searchParams.append('scope', scopesToUse.join(' '))
  authUrl.searchParams.append('code_challenge', codeChallenge)
  authUrl.searchParams.append('code_challenge_method', 'S256')
  authUrl.searchParams.append('state', state)

  if (orgUUID) {
    authUrl.searchParams.append('orgUUID', orgUUID)
  }
  if (loginHint) {
    authUrl.searchParams.append('login_hint', loginHint)
  }
  if (loginMethod) {
    authUrl.searchParams.append('login_method', loginMethod)
  }

  return authUrl.toString()
}

export interface TokenExchangeResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
  account?: {
    uuid: string
    email_address: string
  }
  organization?: {
    uuid: string
  }
}

export async function exchangeCodeForTokens(
  authorizationCode: string,
  state: string,
  codeVerifier: string,
  port: number,
  useManualRedirect = false,
  expiresIn?: number
): Promise<TokenExchangeResponse> {
  const config = getOauthConfig()
  const requestBody: Record<string, unknown> = {
    grant_type: 'authorization_code',
    code: authorizationCode,
    redirect_uri: useManualRedirect
      ? config.MANUAL_REDIRECT_URL
      : `http://localhost:${port}/callback`,
    client_id: config.CLIENT_ID,
    code_verifier: codeVerifier,
    state,
  }

  if (expiresIn !== undefined) {
    requestBody.expires_in = expiresIn
  }

  const response = await axios.post<TokenExchangeResponse>(
    config.TOKEN_URL,
    requestBody,
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15_000,
    }
  )

  if (response.status !== 200) {
    throw new Error(
      response.status === 401
        ? 'Authentication failed: Invalid authorization code'
        : `Token exchange failed (${response.status}): ${response.statusText}`
    )
  }

  logEvent('tengu_oauth_token_exchange_success', {})
  return response.data
}

export async function refreshOAuthToken(
  refreshToken: string,
  options?: { scopes?: string[] }
): Promise<{
  accessToken: string
  refreshToken: string
  expiresAt: number
  scopes: string[]
}> {
  const config = getOauthConfig()
  const requestedScopes = options?.scopes

  const requestBody = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.CLIENT_ID,
    scope: (requestedScopes?.length
      ? requestedScopes
      : CLAUDE_AI_OAUTH_SCOPES
    ).join(' '),
  }

  const response = await axios.post<{
    access_token: string
    refresh_token?: string
    expires_in: number
    scope?: string
  }>(config.TOKEN_URL, requestBody, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15_000,
  })

  if (response.status !== 200) {
    throw new Error(`Token refresh failed: ${response.statusText}`)
  }

  const data = response.data
  const {
    access_token: accessToken,
    refresh_token: newRefreshToken = refreshToken,
    expires_in: expiresIn,
  } = data

  const expiresAt = Date.now() + expiresIn * 1000
  const scopes = parseScopes(data.scope)

  logEvent('tengu_oauth_token_refresh_success', {})

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresAt,
    scopes,
  }
}

export async function fetchProfileInfo(
  accessToken: string
): Promise<ProfileInfo> {
  const { getOauthProfileFromOauthToken } = await import('./getOauthProfile.js')
  const profile = await getOauthProfileFromOauthToken(accessToken)

  const orgType = profile?.organization?.organization_type
  let subscriptionType: string | null = null

  switch (orgType) {
    case 'claude_max':
      subscriptionType = 'max'
      break
    case 'claude_pro':
      subscriptionType = 'pro'
      break
    case 'claude_enterprise':
      subscriptionType = 'enterprise'
      break
    case 'claude_team':
      subscriptionType = 'team'
      break
    default:
      subscriptionType = null
      break
  }

  const result: ProfileInfo = {
    subscriptionType,
    rateLimitTier: profile?.organization?.rate_limit_tier ?? null,
    hasExtraUsageEnabled: profile?.organization?.has_extra_usage_enabled ?? null,
    billingType: profile?.organization?.billing_type ?? null,
    rawProfile: profile,
  }

  if (profile?.account?.display_name) {
    result.displayName = profile.account.display_name
  }
  if (profile?.account?.created_at) {
    result.accountCreatedAt = profile.account.created_at
  }
  if (profile?.organization?.subscription_created_at) {
    result.subscriptionCreatedAt = profile.organization.subscription_created_at
  }

  logEvent('tengu_oauth_profile_fetch_success', {})
  return result
}

export function isOAuthTokenExpired(expiresAt: number | null): boolean {
  if (expiresAt === null) return false
  const bufferTime = 5 * 60 * 1000
  return Date.now() + bufferTime >= expiresAt
}

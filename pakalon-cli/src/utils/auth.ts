import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface ClaudeAIOAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  subscriptionType?: string | null
  rateLimitTier?: string | null
}

export interface OauthAccountInfo {
  accountUuid: string
  emailAddress: string
  organizationUuid?: string
  displayName?: string
  hasExtraUsageEnabled?: boolean
  billingType?: string
  accountCreatedAt?: string
  subscriptionCreatedAt?: string
  organizationRole?: string
}

let cachedTokens: ClaudeAIOAuthTokens | null = null
let cachedAuthVersion = 0

function getStoragePath(): string {
  const configDir = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config')
  return path.join(configDir, 'pakalon', 'storage.json')
}

function readTokensFromFile(): ClaudeAIOAuthTokens | null {
  try {
    const raw = fs.readFileSync(getStoragePath(), 'utf-8')
    const data = JSON.parse(raw) as Record<string, unknown>
    const accessToken = data.accessToken ?? data.claude_ai_access_token ?? data.token
    if (typeof accessToken !== 'string' || !accessToken) return null
    return {
      accessToken,
      refreshToken: typeof data.refreshToken === 'string' ? data.refreshToken : undefined,
      expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : undefined,
      subscriptionType: typeof data.subscriptionType === 'string' ? data.subscriptionType : null,
      rateLimitTier: typeof data.rateLimitTier === 'string' ? data.rateLimitTier : null,
    }
  } catch {
    return null
  }
}

export function getClaudeAIOAuthTokens(): ClaudeAIOAuthTokens | null {
  if (cachedTokens) {
    const now = Date.now()
    if (cachedTokens.expiresAt && now < cachedTokens.expiresAt - 60_000) {
      return cachedTokens
    }
  }
  cachedTokens = readTokensFromFile()
  cachedAuthVersion++
  return cachedTokens
}

export function getAuthVersion(): number {
  return cachedAuthVersion
}

export function isAnthropicAuthEnabled(): boolean {
  const env = process.env.PAKALON_AUTH_PROVIDER ?? process.env.AUTH_PROVIDER ?? ''
  if (env.toLowerCase() === 'disabled' || env.toLowerCase() === 'none') {
    return false
  }
  return true
}

export function clearAuthCache(): void {
  cachedTokens = null
  cachedAuthVersion++
}

export function getSubscriptionType(): string | null {
  const { shouldUseMockSubscription, getMockSubscriptionType } = require('@/services/mockRateLimits.js')
  if (shouldUseMockSubscription()) {
    return getMockSubscriptionType()
  }

  const tokens = getClaudeAIOAuthTokens()
  return tokens?.subscriptionType ?? null
}

export function isClaudeAISubscriber(): boolean {
  const subType = getSubscriptionType()
  return subType !== null && subType !== 'free'
}

export function getRateLimitTier(): string | null {
  const tokens = getClaudeAIOAuthTokens()
  return tokens?.rateLimitTier ?? null
}

export function getOauthAccountInfo(): OauthAccountInfo | null {
  try {
    const { getGlobalConfig } = require('@/utils/config.js')
    const config = getGlobalConfig()
    return config.oauthAccount ?? null
  } catch {
    return null
  }
}

export function hasProfileScope(): boolean {
  const tokens = getClaudeAIOAuthTokens()
  if (!tokens?.accessToken) return false

  try {
    const parts = tokens.accessToken.split('.')
    if (parts.length !== 3) return false
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString())
    const scopes = (payload.scope as string)?.split(' ') ?? []
    return scopes.includes('organization:profile')
  } catch {
    return false
  }
}

export function isOverageProvisioningAllowed(): boolean {
  const account = getOauthAccountInfo()
  if (!account) return true

  const billingType = account.billingType
  if (!billingType) return true

  const disallowedTypes = ['aws_marketplace', 'invoice']
  return !disallowedTypes.includes(billingType.toLowerCase())
}

export function getAnthropicApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY
}

export async function saveApiKey(apiKey: string): Promise<void> {
  process.env.ANTHROPIC_API_KEY = apiKey
}

export async function checkAndRefreshOAuthTokenIfNeeded(): Promise<void> {
  const tokens = getClaudeAIOAuthTokens()
  if (!tokens?.refreshToken) return
  if (tokens.expiresAt && Date.now() < tokens.expiresAt - 5 * 60 * 1000) return

  try {
    const { refreshOAuthToken } = require('@/services/oauth/client.js')
    const result = await refreshOAuthToken(tokens.refreshToken)

    const { getGlobalConfig, saveGlobalConfig } = require('@/utils/config.js')
    const config = getGlobalConfig()

    saveGlobalConfig((current: Record<string, unknown>) => ({
      ...current,
      oauthAccount: current.oauthAccount ?? {},
    }))

    cachedTokens = {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: result.expiresAt,
    }
    cachedAuthVersion++
  } catch {
    // Token refresh failed — will retry on next check
  }
}

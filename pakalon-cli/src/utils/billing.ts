/**
 * Billing utility — Claude.ai billing access checks and overrides.
 */

let billingAccessOverride: boolean | null = null

export function hasClaudeAiBillingAccess(): boolean {
  if (billingAccessOverride !== null) {
    return billingAccessOverride
  }

  try {
    const { getGlobalConfig } = require('@/utils/config.js')
    const config = getGlobalConfig()
    const role = config.oauthAccount?.organizationRole
    if (!role) return true

    const billingRoles = ['owner', 'admin', 'billing_admin']
    return billingRoles.includes(role.toLowerCase())
  } catch {
    return true
  }
}

export function setMockBillingAccessOverride(hasAccess: boolean | null): void {
  billingAccessOverride = hasAccess
}

export function clearBillingAccessOverride(): void {
  billingAccessOverride = null
}

export interface BillingState {
  hasBillingAccess: boolean
  subscriptionType: string | null
  rateLimitTier: string | null
  hasExtraUsageEnabled: boolean | null
  billingType: string | null
}

export function getBillingState(): BillingState {
  try {
    const { getGlobalConfig } = require('@/utils/config.js')
    const { getClaudeAIOAuthTokens } = require('@/utils/auth.js')

    const config = getGlobalConfig()
    const tokens = getClaudeAIOAuthTokens()
    const oauthAccount = config.oauthAccount

    return {
      hasBillingAccess: hasClaudeAiBillingAccess(),
      subscriptionType: oauthAccount?.billingType ?? null,
      rateLimitTier: tokens?.rateLimitTier ?? null,
      hasExtraUsageEnabled: oauthAccount?.hasExtraUsageEnabled ?? null,
      billingType: oauthAccount?.billingType ?? null,
    }
  } catch {
    return {
      hasBillingAccess: true,
      subscriptionType: null,
      rateLimitTier: null,
      hasExtraUsageEnabled: null,
      billingType: null,
    }
  }
}

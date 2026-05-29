/**
 * Claude AI Limits — rate limit status tracking and quota checking.
 */
import { APIError } from '@anthropic-ai/sdk'
import isEqual from 'lodash-es/isEqual.js'
import { logEvent } from './analytics/index.js'

export interface ClaudeAILimits {
  status: 'allowed' | 'allowed_warning' | 'rejected'
  resetsAt?: number
  rateLimitType?: string
  utilization?: number
  unifiedRateLimitFallbackAvailable: boolean
  isUsingOverage: boolean
  overageStatus?: string
  overageResetsAt?: number
  overageDisabledReason?: string
  surpassedThreshold?: number
}

const EARLY_WARNING_CONFIGS = [
  {
    rateLimitType: 'five_hour',
    claimAbbrev: '5h',
    windowSeconds: 5 * 60 * 60,
    thresholds: [{ utilization: 0.9, timePct: 0.72 }],
  },
  {
    rateLimitType: 'seven_day',
    claimAbbrev: '7d',
    windowSeconds: 7 * 24 * 60 * 60,
    thresholds: [
      { utilization: 0.75, timePct: 0.6 },
      { utilization: 0.5, timePct: 0.35 },
      { utilization: 0.25, timePct: 0.15 },
    ],
  },
]

const EARLY_WARNING_CLAIM_MAP: Record<string, string> = {
  '5h': 'five_hour',
  '7d': 'seven_day',
  overage: 'overage',
}

const RATE_LIMIT_DISPLAY_NAMES: Record<string, string> = {
  five_hour: 'session limit',
  seven_day: 'weekly limit',
  seven_day_opus: 'Opus limit',
  seven_day_sonnet: 'Sonnet limit',
  overage: 'extra usage limit',
}

export function getRateLimitDisplayName(type: string): string {
  return RATE_LIMIT_DISPLAY_NAMES[type] || type
}

export let currentLimits: ClaudeAILimits = {
  status: 'allowed',
  unifiedRateLimitFallbackAvailable: false,
  isUsingOverage: false,
}

let rawUtilization: Record<string, { utilization: number; resets_at: number }> = {}

export function getRawUtilization(): typeof rawUtilization {
  return rawUtilization
}

export const statusListeners = new Set<(limits: ClaudeAILimits) => void>()

export function emitStatusChange(limits: ClaudeAILimits): void {
  currentLimits = limits
  statusListeners.forEach(listener => listener(limits))

  const hoursTillReset = Math.round(
    (limits.resetsAt ? limits.resetsAt - Date.now() / 1000 : 0) / (60 * 60)
  )

  logEvent('tengu_claudeai_limits_status_changed', {
    status: limits.status,
    unifiedRateLimitFallbackAvailable: limits.unifiedRateLimitFallbackAvailable,
    hoursTillReset,
  })
}

function computeTimeProgress(resetsAt: number, windowSeconds: number): number {
  const nowSeconds = Date.now() / 1000
  const windowStart = resetsAt - windowSeconds
  const elapsed = nowSeconds - windowStart
  return Math.max(0, Math.min(1, elapsed / windowSeconds))
}

function extractRawUtilization(headers: Headers): typeof rawUtilization {
  const result: typeof rawUtilization = {}
  for (const [key, abbrev] of [
    ['five_hour', '5h'],
    ['seven_day', '7d'],
  ] as const) {
    const util = headers.get(`anthropic-ratelimit-unified-${abbrev}-utilization`)
    const reset = headers.get(`anthropic-ratelimit-unified-${abbrev}-reset`)
    if (util !== null && reset !== null) {
      result[key] = { utilization: Number(util), resets_at: Number(reset) }
    }
  }
  return result
}

function getHeaderBasedEarlyWarning(
  headers: Headers,
  unifiedRateLimitFallbackAvailable: boolean
): ClaudeAILimits | null {
  for (const [claimAbbrev, rateLimitType] of Object.entries(EARLY_WARNING_CLAIM_MAP)) {
    const surpassedThreshold = headers.get(
      `anthropic-ratelimit-unified-${claimAbbrev}-surpassed-threshold`
    )
    if (surpassedThreshold !== null) {
      const utilizationHeader = headers.get(
        `anthropic-ratelimit-unified-${claimAbbrev}-utilization`
      )
      const resetHeader = headers.get(
        `anthropic-ratelimit-unified-${claimAbbrev}-reset`
      )
      return {
        status: 'allowed_warning',
        resetsAt: resetHeader ? Number(resetHeader) : undefined,
        rateLimitType,
        utilization: utilizationHeader ? Number(utilizationHeader) : undefined,
        unifiedRateLimitFallbackAvailable,
        isUsingOverage: false,
        surpassedThreshold: Number(surpassedThreshold),
      }
    }
  }
  return null
}

function getTimeRelativeEarlyWarning(
  headers: Headers,
  config: (typeof EARLY_WARNING_CONFIGS)[number],
  unifiedRateLimitFallbackAvailable: boolean
): ClaudeAILimits | null {
  const { rateLimitType, claimAbbrev, windowSeconds, thresholds } = config
  const utilizationHeader = headers.get(
    `anthropic-ratelimit-unified-${claimAbbrev}-utilization`
  )
  const resetHeader = headers.get(
    `anthropic-ratelimit-unified-${claimAbbrev}-reset`
  )
  if (utilizationHeader === null || resetHeader === null) return null

  const utilization = Number(utilizationHeader)
  const resetsAt = Number(resetHeader)
  const timeProgress = computeTimeProgress(resetsAt, windowSeconds)

  const shouldWarn = thresholds.some(
    t => utilization >= t.utilization && timeProgress <= t.timePct
  )
  if (!shouldWarn) return null

  return {
    status: 'allowed_warning',
    resetsAt,
    rateLimitType,
    utilization,
    unifiedRateLimitFallbackAvailable,
    isUsingOverage: false,
  }
}

function getEarlyWarningFromHeaders(
  headers: Headers,
  unifiedRateLimitFallbackAvailable: boolean
): ClaudeAILimits | null {
  const headerBasedWarning = getHeaderBasedEarlyWarning(
    headers,
    unifiedRateLimitFallbackAvailable
  )
  if (headerBasedWarning) return headerBasedWarning

  for (const config of EARLY_WARNING_CONFIGS) {
    const timeRelativeWarning = getTimeRelativeEarlyWarning(
      headers,
      config,
      unifiedRateLimitFallbackAvailable
    )
    if (timeRelativeWarning) return timeRelativeWarning
  }
  return null
}

function computeNewLimitsFromHeaders(headers: Headers): ClaudeAILimits {
  const status = headers.get('anthropic-ratelimit-unified-status') || 'allowed'
  const resetsAtHeader = headers.get('anthropic-ratelimit-unified-reset')
  const resetsAt = resetsAtHeader ? Number(resetsAtHeader) : undefined
  const unifiedRateLimitFallbackAvailable =
    headers.get('anthropic-ratelimit-unified-fallback') === 'available'
  const rateLimitType = headers.get(
    'anthropic-ratelimit-unified-representative-claim'
  )
  const overageStatus = headers.get(
    'anthropic-ratelimit-unified-overage-status'
  )
  const overageResetsAtHeader = headers.get(
    'anthropic-ratelimit-unified-overage-reset'
  )
  const overageResetsAt = overageResetsAtHeader
    ? Number(overageResetsAtHeader)
    : undefined
  const overageDisabledReason = headers.get(
    'anthropic-ratelimit-unified-overage-disabled-reason'
  )

  const isUsingOverage =
    status === 'rejected' &&
    (overageStatus === 'allowed' || overageStatus === 'allowed_warning')

  let finalStatus = status
  if (status === 'allowed' || status === 'allowed_warning') {
    const earlyWarning = getEarlyWarningFromHeaders(
      headers,
      unifiedRateLimitFallbackAvailable
    )
    if (earlyWarning) return earlyWarning
    finalStatus = 'allowed'
  }

  return {
    status: finalStatus,
    resetsAt,
    unifiedRateLimitFallbackAvailable,
    ...(rateLimitType && { rateLimitType }),
    ...(overageStatus && { overageStatus }),
    ...(overageResetsAt && { overageResetsAt }),
    ...(overageDisabledReason && { overageDisabledReason }),
    isUsingOverage,
  }
}

export function extractQuotaStatusFromHeaders(headers: Headers): void {
  const { shouldProcessRateLimits, processRateLimitHeaders } = require('./rateLimitMocking.js')
  const { isClaudeAISubscriber } = require('@/utils/auth.js')

  const isSubscriber = isClaudeAISubscriber()
  if (!shouldProcessRateLimits(isSubscriber)) {
    rawUtilization = {}
    if (currentLimits.status !== 'allowed' || currentLimits.resetsAt) {
      emitStatusChange({
        status: 'allowed',
        unifiedRateLimitFallbackAvailable: false,
        isUsingOverage: false,
      })
    }
    return
  }

  const headersToUse = processRateLimitHeaders(headers)
  rawUtilization = extractRawUtilization(headersToUse)
  const newLimits = computeNewLimitsFromHeaders(headersToUse)

  if (!isEqual(currentLimits, newLimits)) {
    emitStatusChange(newLimits)
  }
}

export function extractQuotaStatusFromError(error: APIError): void {
  const { shouldProcessRateLimits, processRateLimitHeaders } = require('./rateLimitMocking.js')
  const { isClaudeAISubscriber } = require('@/utils/auth.js')

  if (!shouldProcessRateLimits(isClaudeAISubscriber()) || error.status !== 429) {
    return
  }

  try {
    let newLimits = { ...currentLimits }
    if (error.headers) {
      const headersToUse = processRateLimitHeaders(error.headers as Headers)
      rawUtilization = extractRawUtilization(headersToUse)
      newLimits = computeNewLimitsFromHeaders(headersToUse)
    }
    newLimits.status = 'rejected'
    if (!isEqual(currentLimits, newLimits)) {
      emitStatusChange(newLimits)
    }
  } catch {
    // Silently ignore errors in limit extraction
  }
}

export async function checkQuotaStatus(): Promise<void> {
  const { shouldProcessRateLimits } = require('./rateLimitMocking.js')
  const { isClaudeAISubscriber } = require('@/utils/auth.js')
  const { isEssentialTrafficOnly } = require('@/utils/privacyLevel.js')
  const { getIsNonInteractiveSession } = require('@/bootstrap/state.js')

  if (isEssentialTrafficOnly()) return
  if (!shouldProcessRateLimits(isClaudeAISubscriber())) return
  if (getIsNonInteractiveSession()) return

  try {
    const { getAnthropicClient } = require('@/services/api/client.js')
    const { getModelBetas } = require('@/utils/betas.js')
    const { getSmallFastModel } = require('@/utils/model/model.js')
    const { getAPIMetadata } = require('@/services/api/claude.js')

    const model = getSmallFastModel()
    const anthropic = await getAnthropicClient({
      maxRetries: 0,
      model,
      source: 'quota_check',
    })

    const messages = [{ role: 'user', content: 'quota' }]
    const betas = getModelBetas(model)

    const response = await anthropic.beta.messages
      .create({
        model,
        max_tokens: 1,
        messages,
        metadata: getAPIMetadata(),
        ...(betas.length > 0 ? { betas } : {}),
      })
      .asResponse()

    extractQuotaStatusFromHeaders(response.headers)
  } catch (error) {
    if (error instanceof APIError) {
      extractQuotaStatusFromError(error)
    }
  }
}

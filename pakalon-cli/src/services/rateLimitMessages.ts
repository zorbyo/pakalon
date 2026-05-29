/**
 * Centralized rate limit message generation.
 * Single source of truth for all rate limit-related messages.
 */
import { formatResetTime } from '../utils/format.js'

const FEEDBACK_CHANNEL_ANT = '#briarpatch-cc'

export const RATE_LIMIT_ERROR_PREFIXES = [
  "You've hit your",
  "You've used",
  "You're now using extra usage",
  "You're close to",
  "You're out of extra usage",
]

export function isRateLimitErrorMessage(text: string): boolean {
  return RATE_LIMIT_ERROR_PREFIXES.some(prefix => text.startsWith(prefix))
}

export interface RateLimitMessage {
  message: string
  severity: 'error' | 'warning'
}

export function getRateLimitMessage(
  limits: {
    status: string
    isUsingOverage: boolean
    overageStatus?: string
    resetsAt?: number
    overageResetsAt?: number
    overageDisabledReason?: string
    rateLimitType?: string
    utilization?: number
  },
  model: string
): RateLimitMessage | null {
  if (limits.isUsingOverage) {
    if (limits.overageStatus === 'allowed_warning') {
      return {
        message: "You're close to your extra usage spending limit",
        severity: 'warning',
      }
    }
    return null
  }

  if (limits.status === 'rejected') {
    return { message: getLimitReachedText(limits, model), severity: 'error' }
  }

  if (limits.status === 'allowed_warning') {
    const WARNING_THRESHOLD = 0.7
    if (
      limits.utilization !== undefined &&
      limits.utilization < WARNING_THRESHOLD
    ) {
      return null
    }

    const text = getEarlyWarningText(limits)
    if (text) {
      return { message: text, severity: 'warning' }
    }
  }

  return null
}

export function getRateLimitErrorMessage(
  limits: Parameters<typeof getRateLimitMessage>[0],
  model: string
): string | null {
  const message = getRateLimitMessage(limits, model)
  if (message && message.severity === 'error') {
    return message.message
  }
  return null
}

export function getRateLimitWarning(
  limits: Parameters<typeof getRateLimitMessage>[0],
  model: string
): string | null {
  const message = getRateLimitMessage(limits, model)
  if (message && message.severity === 'warning') {
    return message.message
  }
  return null
}

function getLimitReachedText(
  limits: {
    resetsAt?: number
    overageResetsAt?: number
    overageStatus?: string
    overageDisabledReason?: string
    rateLimitType?: string
  },
  model: string
): string {
  const resetsAt = limits.resetsAt
  const resetTime = resetsAt ? formatResetTime(resetsAt, true) : undefined
  const overageResetTime = limits.overageResetsAt
    ? formatResetTime(limits.overageResetsAt, true)
    : undefined
  const resetMessage = resetTime ? ` · resets ${resetTime}` : ''

  if (limits.overageStatus === 'rejected') {
    let overageResetMessage = ''
    if (resetsAt && limits.overageResetsAt) {
      if (resetsAt < limits.overageResetsAt) {
        overageResetMessage = ` · resets ${resetTime}`
      } else {
        overageResetMessage = ` · resets ${overageResetTime}`
      }
    } else if (resetTime) {
      overageResetMessage = ` · resets ${resetTime}`
    } else if (overageResetTime) {
      overageResetMessage = ` · resets ${overageResetTime}`
    }

    if (limits.overageDisabledReason === 'out_of_credits') {
      return `You're out of extra usage${overageResetMessage}`
    }
    return formatLimitReachedText('limit', overageResetMessage, model)
  }

  if (limits.rateLimitType === 'seven_day_sonnet') {
    return formatLimitReachedText('weekly limit', resetMessage, model)
  }
  if (limits.rateLimitType === 'seven_day_opus') {
    return formatLimitReachedText('Opus limit', resetMessage, model)
  }
  if (limits.rateLimitType === 'seven_day') {
    return formatLimitReachedText('weekly limit', resetMessage, model)
  }
  if (limits.rateLimitType === 'five_hour') {
    return formatLimitReachedText('session limit', resetMessage, model)
  }
  return formatLimitReachedText('usage limit', resetMessage, model)
}

function getEarlyWarningText(limits: {
  rateLimitType?: string
  utilization?: number
  resetsAt?: number
}): string | null {
  let limitName: string | null = null
  switch (limits.rateLimitType) {
    case 'seven_day':
      limitName = 'weekly limit'
      break
    case 'five_hour':
      limitName = 'session limit'
      break
    case 'seven_day_opus':
      limitName = 'Opus limit'
      break
    case 'seven_day_sonnet':
      limitName = 'Sonnet limit'
      break
    case 'overage':
      limitName = 'extra usage'
      break
    case undefined:
      return null
  }

  const used = limits.utilization
    ? Math.floor(limits.utilization * 100)
    : undefined
  const resetTime = limits.resetsAt
    ? formatResetTime(limits.resetsAt, true)
    : undefined

  if (used && resetTime) {
    return `You've used ${used}% of your ${limitName} · resets ${resetTime}`
  }
  if (used) {
    return `You've used ${used}% of your ${limitName}`
  }
  if (limits.rateLimitType === 'overage') {
    limitName += ' limit'
  }
  if (resetTime) {
    return `Approaching ${limitName} · resets ${resetTime}`
  }
  return `Approaching ${limitName}`
}

export function getUsingOverageText(limits: {
  resetsAt?: number
  rateLimitType?: string
}): string {
  const resetTime = limits.resetsAt
    ? formatResetTime(limits.resetsAt, true)
    : ''
  let limitName = ''

  if (limits.rateLimitType === 'five_hour') {
    limitName = 'session limit'
  } else if (limits.rateLimitType === 'seven_day') {
    limitName = 'weekly limit'
  } else if (limits.rateLimitType === 'seven_day_opus') {
    limitName = 'Opus limit'
  } else if (limits.rateLimitType === 'seven_day_sonnet') {
    limitName = 'weekly limit'
  }

  if (!limitName) return 'Now using extra usage'

  const resetMessage = resetTime
    ? ` · Your ${limitName} resets ${resetTime}`
    : ''
  return `You're now using extra usage${resetMessage}`
}

function formatLimitReachedText(
  limit: string,
  resetMessage: string,
  _model: string
): string {
  if (process.env.USER_TYPE === 'ant') {
    return `You've hit your ${limit}${resetMessage}. If you have feedback about this limit, post in ${FEEDBACK_CHANNEL_ANT}. You can reset your limits with /reset-limits`
  }
  return `You've hit your ${limit}${resetMessage}`
}

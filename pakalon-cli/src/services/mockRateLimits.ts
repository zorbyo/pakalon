/**
 * Mock rate limits for internal testing.
 *
 * WARNING: This is for internal testing/demo purposes only.
 * Mock headers may not exactly match the API specification.
 */
import { setMockBillingAccessOverride } from '../utils/billing.js'

interface ExceededLimit {
  type: string
  resetsAt: number
}

let mockHeaders: Record<string, string> = {}
let mockEnabled = false
let mockHeaderless429Message: string | null = null
let mockSubscriptionType: string | null = null
let mockFastModeRateLimitDurationMs: number | null = null
let mockFastModeRateLimitExpiresAt: number | null = null
let exceededLimits: ExceededLimit[] = []

const DEFAULT_MOCK_SUBSCRIPTION = 'max'

function updateRetryAfter(): void {
  const status = mockHeaders['anthropic-ratelimit-unified-status']
  const overageStatus = mockHeaders['anthropic-ratelimit-unified-overage-status']
  const reset = mockHeaders['anthropic-ratelimit-unified-reset']

  if (
    status === 'rejected' &&
    (!overageStatus || overageStatus === 'rejected') &&
    reset
  ) {
    const resetTimestamp = Number(reset)
    const secondsUntilReset = Math.max(
      0,
      resetTimestamp - Math.floor(Date.now() / 1000)
    )
    mockHeaders['retry-after'] = String(secondsUntilReset)
  } else {
    delete mockHeaders['retry-after']
  }
}

function updateRepresentativeClaim(): void {
  if (exceededLimits.length === 0) {
    delete mockHeaders['anthropic-ratelimit-unified-representative-claim']
    delete mockHeaders['anthropic-ratelimit-unified-reset']
    delete mockHeaders['retry-after']
    return
  }

  const furthest = exceededLimits.reduce((prev, curr) =>
    curr.resetsAt > prev.resetsAt ? curr : prev
  )

  mockHeaders['anthropic-ratelimit-unified-representative-claim'] = furthest.type
  mockHeaders['anthropic-ratelimit-unified-reset'] = String(furthest.resetsAt)

  if (mockHeaders['anthropic-ratelimit-unified-status'] === 'rejected') {
    const overageStatus = mockHeaders['anthropic-ratelimit-unified-overage-status']
    if (!overageStatus || overageStatus === 'rejected') {
      const secondsUntilReset = Math.max(
        0,
        furthest.resetsAt - Math.floor(Date.now() / 1000)
      )
      mockHeaders['retry-after'] = String(secondsUntilReset)
    } else {
      delete mockHeaders['retry-after']
    }
  } else {
    delete mockHeaders['retry-after']
  }
}

export function setMockHeader(key: string, value: string | undefined): void {
  if (process.env.USER_TYPE !== 'ant') return

  mockEnabled = true
  const fullKey =
    key === 'retry-after'
      ? 'retry-after'
      : `anthropic-ratelimit-unified-${key}`

  if (value === undefined || value === 'clear') {
    delete mockHeaders[fullKey]
    if (key === 'claim') exceededLimits = []
    if (key === 'status' || key === 'overage-status') updateRetryAfter()
    return
  }

  if (key === 'reset' || key === 'overage-reset') {
    const hours = Number(value)
    if (!isNaN(hours)) {
      value = String(Math.floor(Date.now() / 1000) + hours * 3600)
    }
  }

  if (key === 'claim') {
    const validClaims = [
      'five_hour',
      'seven_day',
      'seven_day_opus',
      'seven_day_sonnet',
    ]
    if (validClaims.includes(value)) {
      let resetsAt: number
      if (value === 'five_hour') {
        resetsAt = Math.floor(Date.now() / 1000) + 5 * 3600
      } else {
        resetsAt = Math.floor(Date.now() / 1000) + 7 * 24 * 3600
      }
      exceededLimits = exceededLimits.filter(l => l.type !== value)
      exceededLimits.push({ type: value, resetsAt })
      updateRepresentativeClaim()
      return
    }
  }

  mockHeaders[fullKey] = value
  if (key === 'status' || key === 'overage-status') updateRetryAfter()

  if (Object.keys(mockHeaders).length === 0) mockEnabled = false
}

export function addExceededLimit(type: string, hoursFromNow: number): void {
  if (process.env.USER_TYPE !== 'ant') return

  mockEnabled = true
  const resetsAt = Math.floor(Date.now() / 1000) + hoursFromNow * 3600
  exceededLimits = exceededLimits.filter(l => l.type !== type)
  exceededLimits.push({ type, resetsAt })

  if (exceededLimits.length > 0) {
    mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
  }
  updateRepresentativeClaim()
}

export function setMockEarlyWarning(
  claimAbbrev: string,
  utilization: number,
  hoursFromNow?: number
): void {
  if (process.env.USER_TYPE !== 'ant') return

  mockEnabled = true
  clearMockEarlyWarning()

  const defaultHours = claimAbbrev === '5h' ? 4 : 5 * 24
  const hours = hoursFromNow ?? defaultHours
  const resetsAt = Math.floor(Date.now() / 1000) + hours * 3600

  mockHeaders[`anthropic-ratelimit-unified-${claimAbbrev}-utilization`] =
    String(utilization)
  mockHeaders[`anthropic-ratelimit-unified-${claimAbbrev}-reset`] =
    String(resetsAt)
  mockHeaders[
    `anthropic-ratelimit-unified-${claimAbbrev}-surpassed-threshold`
  ] = String(utilization)

  if (!mockHeaders['anthropic-ratelimit-unified-status']) {
    mockHeaders['anthropic-ratelimit-unified-status'] = 'allowed'
  }
}

export function clearMockEarlyWarning(): void {
  delete mockHeaders['anthropic-ratelimit-unified-5h-utilization']
  delete mockHeaders['anthropic-ratelimit-unified-5h-reset']
  delete mockHeaders['anthropic-ratelimit-unified-5h-surpassed-threshold']
  delete mockHeaders['anthropic-ratelimit-unified-7d-utilization']
  delete mockHeaders['anthropic-ratelimit-unified-7d-reset']
  delete mockHeaders['anthropic-ratelimit-unified-7d-surpassed-threshold']
}

export function setMockRateLimitScenario(scenario: string): void {
  if (process.env.USER_TYPE !== 'ant') return

  if (scenario === 'clear') {
    mockHeaders = {}
    mockHeaderless429Message = null
    mockEnabled = false
    return
  }

  mockEnabled = true
  const fiveHoursFromNow = Math.floor(Date.now() / 1000) + 5 * 3600
  const sevenDaysFromNow = Math.floor(Date.now() / 1000) + 7 * 24 * 3600
  mockHeaders = {}
  mockHeaderless429Message = null

  const preserveExceededLimits = [
    'overage-active',
    'overage-warning',
    'overage-exhausted',
  ].includes(scenario)
  if (!preserveExceededLimits) exceededLimits = []

  switch (scenario) {
    case 'normal':
      mockHeaders = {
        'anthropic-ratelimit-unified-status': 'allowed',
        'anthropic-ratelimit-unified-reset': String(fiveHoursFromNow),
      }
      break
    case 'session-limit-reached':
      exceededLimits = [{ type: 'five_hour', resetsAt: fiveHoursFromNow }]
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      break
    case 'approaching-weekly-limit':
      mockHeaders = {
        'anthropic-ratelimit-unified-status': 'allowed_warning',
        'anthropic-ratelimit-unified-reset': String(sevenDaysFromNow),
        'anthropic-ratelimit-unified-representative-claim': 'seven_day',
      }
      break
    case 'weekly-limit-reached':
      exceededLimits = [{ type: 'seven_day', resetsAt: sevenDaysFromNow }]
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      break
    case 'overage-active':
    case 'overage-warning':
    case 'overage-exhausted': {
      if (exceededLimits.length === 0) {
        exceededLimits = [{ type: 'five_hour', resetsAt: fiveHoursFromNow }]
      }
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-status'] =
        scenario === 'overage-active'
          ? 'allowed'
          : scenario === 'overage-warning'
            ? 'allowed_warning'
            : 'rejected'
      const endOfMonth = new Date()
      endOfMonth.setMonth(endOfMonth.getMonth() + 1, 1)
      endOfMonth.setHours(0, 0, 0, 0)
      mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonth.getTime() / 1000)
      )
      break
    }
    case 'out-of-credits':
    case 'org-zero-credit-limit':
    case 'org-spend-cap-hit':
    case 'member-zero-credit-limit':
    case 'seat-tier-zero-credit-limit': {
      if (exceededLimits.length === 0) {
        exceededLimits = [{ type: 'five_hour', resetsAt: fiveHoursFromNow }]
      }
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-status'] = 'rejected'
      const reasonMap: Record<string, string> = {
        'out-of-credits': 'out_of_credits',
        'org-zero-credit-limit': 'org_service_zero_credit_limit',
        'org-spend-cap-hit': 'org_level_disabled_until',
        'member-zero-credit-limit': 'member_zero_credit_limit',
        'seat-tier-zero-credit-limit': 'seat_tier_zero_credit_limit',
      }
      mockHeaders['anthropic-ratelimit-unified-overage-disabled-reason'] =
        reasonMap[scenario] ?? 'out_of_credits'
      const endOfMonth = new Date()
      endOfMonth.setMonth(endOfMonth.getMonth() + 1, 1)
      endOfMonth.setHours(0, 0, 0, 0)
      mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonth.getTime() / 1000)
      )
      break
    }
    case 'opus-limit':
      exceededLimits = [{ type: 'seven_day_opus', resetsAt: sevenDaysFromNow }]
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      break
    case 'opus-warning':
      mockHeaders = {
        'anthropic-ratelimit-unified-status': 'allowed_warning',
        'anthropic-ratelimit-unified-reset': String(sevenDaysFromNow),
        'anthropic-ratelimit-unified-representative-claim': 'seven_day_opus',
      }
      break
    case 'sonnet-limit':
      exceededLimits = [{ type: 'seven_day_sonnet', resetsAt: sevenDaysFromNow }]
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      break
    case 'sonnet-warning':
      mockHeaders = {
        'anthropic-ratelimit-unified-status': 'allowed_warning',
        'anthropic-ratelimit-unified-reset': String(sevenDaysFromNow),
        'anthropic-ratelimit-unified-representative-claim': 'seven_day_sonnet',
      }
      break
    case 'fast-mode-limit':
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      mockFastModeRateLimitDurationMs = 10 * 60 * 1000
      break
    case 'fast-mode-short-limit':
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      mockFastModeRateLimitDurationMs = 10 * 1000
      break
    case 'extra-usage-required':
      mockHeaderless429Message =
        'Extra usage is required for long context requests.'
      break
  }
}

export function getMockHeaderless429Message(): string | null {
  if (process.env.USER_TYPE !== 'ant') return null
  if (process.env.CLAUDE_MOCK_HEADERLESS_429)
    return process.env.CLAUDE_MOCK_HEADERLESS_429
  if (!mockEnabled) return null
  return mockHeaderless429Message
}

export function getMockHeaders(): Record<string, string> | null {
  if (
    !mockEnabled ||
    process.env.USER_TYPE !== 'ant' ||
    Object.keys(mockHeaders).length === 0
  ) {
    return null
  }
  return mockHeaders
}

export function getMockStatus(): string {
  if (
    !mockEnabled ||
    (Object.keys(mockHeaders).length === 0 && !mockSubscriptionType)
  ) {
    return 'No mock headers active (using real limits)'
  }
  const lines = ['Active mock headers:']
  const effectiveSubscription = mockSubscriptionType || DEFAULT_MOCK_SUBSCRIPTION
  if (mockSubscriptionType) {
    lines.push(`  Subscription Type: ${mockSubscriptionType} (explicitly set)`)
  } else {
    lines.push(`  Subscription Type: ${effectiveSubscription} (default)`)
  }
  for (const [key, value] of Object.entries(mockHeaders)) {
    if (value !== undefined) {
      const formattedKey = key
        .replace('anthropic-ratelimit-unified-', '')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
      if (key.includes('reset') && value) {
        const timestamp = Number(value)
        const date = new Date(timestamp * 1000)
        lines.push(`  ${formattedKey}: ${value} (${date.toLocaleString()})`)
      } else {
        lines.push(`  ${formattedKey}: ${value}`)
      }
    }
  }
  return lines.join('\n')
}

export function clearMockHeaders(): void {
  mockHeaders = {}
  exceededLimits = []
  mockSubscriptionType = null
  mockFastModeRateLimitDurationMs = null
  mockFastModeRateLimitExpiresAt = null
  mockHeaderless429Message = null
  setMockBillingAccessOverride(null)
  mockEnabled = false
}

export function applyMockHeaders(headers: Headers): Headers {
  const mock = getMockHeaders()
  if (!mock) return headers

  const newHeaders = new Headers(headers)
  for (const [key, value] of Object.entries(mock)) {
    if (value !== undefined) newHeaders.set(key, value)
  }
  return newHeaders
}

export function shouldProcessMockLimits(): boolean {
  if (process.env.USER_TYPE !== 'ant') return false
  return mockEnabled || Boolean(process.env.CLAUDE_MOCK_HEADERLESS_429)
}

export function getCurrentMockScenario(): string | null {
  if (!mockEnabled) return null
  if (!mockHeaders) return null

  const status = mockHeaders['anthropic-ratelimit-unified-status']
  const overage = mockHeaders['anthropic-ratelimit-unified-overage-status']
  const claim = mockHeaders['anthropic-ratelimit-unified-representative-claim']

  if (claim === 'seven_day_opus')
    return status === 'rejected' ? 'opus-limit' : 'opus-warning'
  if (claim === 'seven_day_sonnet')
    return status === 'rejected' ? 'sonnet-limit' : 'sonnet-warning'
  if (overage === 'rejected') return 'overage-exhausted'
  if (overage === 'allowed_warning') return 'overage-warning'
  if (overage === 'allowed') return 'overage-active'
  if (status === 'rejected') {
    if (claim === 'five_hour') return 'session-limit-reached'
    if (claim === 'seven_day') return 'weekly-limit-reached'
  }
  if (status === 'allowed_warning') {
    if (claim === 'seven_day') return 'approaching-weekly-limit'
  }
  if (status === 'allowed') return 'normal'
  return null
}

export function getScenarioDescription(scenario: string): string {
  const descriptions: Record<string, string> = {
    normal: 'Normal usage, no limits',
    'session-limit-reached': 'Session rate limit exceeded',
    'approaching-weekly-limit': 'Approaching weekly aggregate limit',
    'weekly-limit-reached': 'Weekly aggregate limit exceeded',
    'overage-active': 'Using extra usage (overage active)',
    'overage-warning': 'Approaching extra usage limit',
    'overage-exhausted': 'Both subscription and extra usage limits exhausted',
    'out-of-credits': 'Out of extra usage credits (wallet empty)',
    'org-zero-credit-limit': 'Org spend cap is zero (no extra usage budget)',
    'org-spend-cap-hit': 'Org spend cap hit for the month',
    'member-zero-credit-limit': 'Member limit is zero (admin can allocate more)',
    'seat-tier-zero-credit-limit':
      'Seat tier limit is zero (admin can allocate more)',
    'opus-limit': 'Opus limit reached',
    'opus-warning': 'Approaching Opus limit',
    'sonnet-limit': 'Sonnet limit reached',
    'sonnet-warning': 'Approaching Sonnet limit',
    'fast-mode-limit': 'Fast mode rate limit',
    'fast-mode-short-limit': 'Fast mode rate limit (short)',
    'extra-usage-required': 'Headerless 429: Extra usage required for 1M context',
    clear: 'Clear mock headers (use real limits)',
  }
  return descriptions[scenario] ?? 'Unknown scenario'
}

export function setMockSubscriptionType(subscriptionType: string): void {
  if (process.env.USER_TYPE !== 'ant') return
  mockEnabled = true
  mockSubscriptionType = subscriptionType
}

export function getMockSubscriptionType(): string | null {
  if (!mockEnabled || process.env.USER_TYPE !== 'ant') return null
  return mockSubscriptionType || DEFAULT_MOCK_SUBSCRIPTION
}

export function shouldUseMockSubscription(): boolean {
  return (
    mockEnabled &&
    mockSubscriptionType !== null &&
    process.env.USER_TYPE === 'ant'
  )
}

export function setMockBillingAccess(hasAccess: boolean): void {
  if (process.env.USER_TYPE !== 'ant') return
  mockEnabled = true
  setMockBillingAccessOverride(hasAccess)
}

export function isMockFastModeRateLimitScenario(): boolean {
  return mockFastModeRateLimitDurationMs !== null
}

export function checkMockFastModeRateLimit(
  isFastModeActive: boolean
): Record<string, string> | null {
  if (mockFastModeRateLimitDurationMs === null) return null
  if (!isFastModeActive) return null

  if (
    mockFastModeRateLimitExpiresAt !== null &&
    Date.now() >= mockFastModeRateLimitExpiresAt
  ) {
    clearMockHeaders()
    return null
  }

  if (mockFastModeRateLimitExpiresAt === null) {
    mockFastModeRateLimitExpiresAt =
      Date.now() + mockFastModeRateLimitDurationMs
  }

  const remainingMs = mockFastModeRateLimitExpiresAt - Date.now()
  const headersToSend = { ...mockHeaders }
  headersToSend['retry-after'] = String(
    Math.max(1, Math.ceil(remainingMs / 1000))
  )
  return headersToSend
}

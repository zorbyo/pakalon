/**
 * Claude AI Limits React hook — provides reactive rate limit status to components.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  currentLimits,
  statusListeners,
  type ClaudeAILimits,
  checkQuotaStatus,
} from './claudeAiLimits.js'

const POLL_INTERVAL_MS = 30_000

export function useClaudeAiLimits(): ClaudeAILimits {
  const [limits, setLimits] = useState<ClaudeAILimits>(currentLimits)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const handleStatusChange = useCallback((newLimits: ClaudeAILimits) => {
    setLimits(newLimits)
  }, [])

  useEffect(() => {
    statusListeners.add(handleStatusChange)

    pollRef.current = setInterval(() => {
      checkQuotaStatus().catch(() => {})
    }, POLL_INTERVAL_MS)

    checkQuotaStatus().catch(() => {})

    return () => {
      statusListeners.delete(handleStatusChange)
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [handleStatusChange])

  return limits
}

export function useIsRateLimited(): boolean {
  const limits = useClaudeAiLimits()
  return limits.status === 'rejected' && !limits.isUsingOverage
}

export function useIsApproachingLimit(): boolean {
  const limits = useClaudeAiLimits()
  return limits.status === 'allowed_warning'
}

export function useIsUsingOverage(): boolean {
  const limits = useClaudeAiLimits()
  return limits.isUsingOverage
}

export function useRateLimitResetTime(): number | undefined {
  const limits = useClaudeAiLimits()
  return limits.resetsAt
}

/**
 * Effort Level Utilities
 *
 * Handles effort level parsing and validation for agents and commands.
 */

export const EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high', 'maximum'] as const
export type EffortLevel = (typeof EFFORT_LEVELS)[number]

const EFFORT_TO_NUMBER: Record<string, number> = {
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  maximum: 5,
}

export function parseEffortValue(value: unknown): number | undefined {
  if (typeof value === 'number' && value > 0 && value <= 10) {
    return value
  }

  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim()
    const numeric = EFFORT_TO_NUMBER[lower]
    if (numeric !== undefined) {
      return numeric
    }

    const parsed = parseInt(value, 10)
    if (!isNaN(parsed) && parsed > 0 && parsed <= 10) {
      return parsed
    }
  }

  return undefined
}

export function getEffortLabel(value: number): string {
  if (value <= 1) return 'minimal'
  if (value <= 2) return 'low'
  if (value <= 3) return 'medium'
  if (value <= 4) return 'high'
  return 'maximum'
}

export function isValidEffort(value: unknown): boolean {
  return parseEffortValue(value) !== undefined
}
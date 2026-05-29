/**
 * Memory Age Utility
 *
 * Calculates and formats the age of memory files for display and
 * prioritization purposes.
 */

export interface MemoryAgeInfo {
  label: string
  days: number
  hours: number
  category: MemoryAgeCategory
  isStale: boolean
  shouldArchive: boolean
}

export type MemoryAgeCategory =
  | 'fresh'
  | 'recent'
  | 'moderate'
  | 'old'
  | 'stale'
  | 'archived'

const STALE_THRESHOLD_DAYS = 30
const ARCHIVE_THRESHOLD_DAYS = 90

export function getMemoryAgeInfo(
  lastModifiedMs: number,
  referenceTime: number = Date.now(),
): MemoryAgeInfo {
  const diffMs = referenceTime - lastModifiedMs
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  const category = categorizeAge(diffDays)
  const label = formatAgeLabel(diffDays, diffHours)

  return {
    label,
    days: diffDays,
    hours: diffHours,
    category,
    isStale: diffDays >= STALE_THRESHOLD_DAYS,
    shouldArchive: diffDays >= ARCHIVE_THRESHOLD_DAYS,
  }
}

function categorizeAge(days: number): MemoryAgeCategory {
  if (days === 0) return 'fresh'
  if (days < 1) return 'fresh'
  if (days < 7) return 'recent'
  if (days < 30) return 'moderate'
  if (days < 60) return 'old'
  if (days < 90) return 'stale'
  return 'archived'
}

function formatAgeLabel(days: number, hours: number): string {
  if (days === 0) {
    if (hours === 0) return 'just now'
    return `${hours}h ago`
  }

  if (days < 7) {
    return `${days}d ago`
  }

  if (days < 30) {
    const weeks = Math.floor(days / 7)
    return `${weeks}w ago`
  }

  if (days < 365) {
    const months = Math.floor(days / 30)
    return `${months}mo ago`
  }

  const years = Math.floor(days / 365)
  return `${years}y ago`
}

export function getMemoryAgeColor(category: MemoryAgeCategory): string {
  switch (category) {
    case 'fresh':
      return '#22c55e'
    case 'recent':
      return '#84cc16'
    case 'moderate':
      return '#eab308'
    case 'old':
      return '#f97316'
    case 'stale':
      return '#ef4444'
    case 'archived':
      return '#6b7280'
  }
}

export function getMemoryAgePriority(
  category: MemoryAgeCategory,
  confidence: number = 1.0,
): number {
  const basePriority: Record<MemoryAgeCategory, number> = {
    fresh: 100,
    recent: 80,
    moderate: 60,
    old: 40,
    stale: 20,
    archived: 5,
  }

  return Math.round(basePriority[category] * confidence)
}

export function isMemoryStale(
  lastModifiedMs: number,
  thresholdDays: number = STALE_THRESHOLD_DAYS,
): boolean {
  const diffDays = Math.floor(
    (Date.now() - lastModifiedMs) / (1000 * 60 * 60 * 24),
  )
  return diffDays >= thresholdDays
}

export function shouldArchiveMemory(
  lastModifiedMs: number,
  thresholdDays: number = ARCHIVE_THRESHOLD_DAYS,
): boolean {
  return isMemoryStale(lastModifiedMs, thresholdDays)
}

'use client'

import { useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useDashboardStats, useHeatmap, useUsage, type ContributionDay } from '@/lib/api'

const TokenUsageChart = dynamic(() => import('@/components/TokenUsageChart'), { ssr: false })

type HeatmapWeek = {
  key: string
  days: Array<ContributionDay | null>
}

type WeekWindow = {
  index: number
  key: string
  start: Date
  end: Date
  label: string
}

type SessionUsageRow = {
  id: string
  sessionId: string
  userPrompt: string
  event: string
  browserOs: string
  timestamp: string
  machineId: string
  ipAddress: string
  tokensUsed: number
  sortTs: number
}

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_DAYS = 7

function startOfDay(value: Date) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function endOfDay(value: Date) {
  const date = new Date(value)
  date.setHours(23, 59, 59, 999)
  return date
}

function toDateInputValue(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toLocalDateKey(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDay(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) {
    return new Date(value)
  }
  return new Date(year, month - 1, day)
}

function formatDateRange(start: Date, end: Date) {
  const format = (value: Date) =>
    value.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  return `${format(start)} – ${format(end)}`
}

function buildWeekWindows(accountCreatedAt: Date | null, now: Date): WeekWindow[] {
  const today = endOfDay(now)
  const firstDay = accountCreatedAt ? startOfDay(accountCreatedAt) : startOfDay(new Date(today.getTime() - 6 * DAY_MS))
  const windows: WeekWindow[] = []

  let weekIndex = 1
  let cursor = new Date(firstDay)
  while (cursor <= today) {
    const start = startOfDay(cursor)
    const end = endOfDay(new Date(start.getTime() + (WEEK_DAYS - 1) * DAY_MS))
    const boundedEnd = end > today ? today : end
    windows.push({
      index: weekIndex,
      key: `${toDateInputValue(start)}__${toDateInputValue(boundedEnd)}`,
      start,
      end: boundedEnd,
      label: `Week-${weekIndex} (${formatDateRange(start, boundedEnd)})`,
    })
    cursor = new Date(start.getTime() + WEEK_DAYS * DAY_MS)
    weekIndex += 1
  }

  return windows
}

function isWithinWeek(value: Date, week: WeekWindow) {
  return value >= week.start && value <= week.end
}

function buildEmptyContributionYear(year: number): ContributionDay[] {
  const days: ContributionDay[] = []
  const current = new Date(year, 0, 1)
  const end = new Date(year, 11, 31)

  while (current <= end) {
    days.push({
      date: toLocalDateKey(current),
      lines_added: 0,
      lines_deleted: 0,
      commits: 0,
      tokens_used: 0,
      sessions_count: 0,
      level: 0,
    })
    current.setDate(current.getDate() + 1)
  }

  return days
}

function calculateContributionLevel(total: number) {
  if (total === 0) return 0
  if (total <= 5) return 1
  if (total <= 15) return 2
  if (total <= 30) return 3
  return 4
}

function buildHeatmapWeeks(contributions: ContributionDay[]): HeatmapWeek[] {
  const source = contributions.toSorted((left, right) => left.date.localeCompare(right.date))
  const weeks: HeatmapWeek[] = []
  let currentWeekKey = ''
  let currentWeek: Array<ContributionDay | null> = Array.from({ length: 7 }, () => null)

  for (const contribution of source) {
    const day = new Date(`${contribution.date}T00:00:00`)
    const weekStart = new Date(day)
    weekStart.setDate(day.getDate() - day.getDay())
    const weekKey = toLocalDateKey(weekStart)

    if (weekKey !== currentWeekKey) {
      if (currentWeekKey) {
        weeks.push({ key: currentWeekKey, days: currentWeek })
      }
      currentWeekKey = weekKey
      currentWeek = Array.from({ length: 7 }, () => null)
    }

    currentWeek[day.getDay()] = contribution
  }

  if (currentWeekKey) {
    weeks.push({ key: currentWeekKey, days: currentWeek })
  }

  return weeks
}

function getContributionColor(level: number) {
  switch (level) {
    case 0:
      return 'bg-[#1d1e18]'
    case 1:
      return 'bg-primary/20'
    case 2:
      return 'bg-primary/40'
    case 3:
      return 'bg-primary/70'
    case 4:
      return 'bg-primary'
    default:
      return 'bg-[#1d1e18]'
  }
}

function formatCompactTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return value.toString()
}

function getContributionTitle(contribution: ContributionDay | null) {
  if (!contribution) return ''
  const label = new Date(`${contribution.date}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return [
    label,
    `${contribution.tokens_used.toLocaleString()} tokens`,
    `${contribution.sessions_count.toLocaleString()} sessions`,
    `${contribution.commits.toLocaleString()} commits`,
  ].join(' • ')
}

export default function DashboardPage() {
  const now = useMemo(() => new Date(), [])
  const [selectedWeekKey, setSelectedWeekKey] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const rowsPerPage = 10

  const { usage, loading: usageLoading, error: usageError } = useUsage()
  const { stats, loading: statsLoading, error: statsError } = useDashboardStats(730)

  const accountCreatedAt = useMemo(
    () => (stats?.user.created_at ? new Date(stats.user.created_at) : null),
    [stats?.user.created_at],
  )

  const accountCreatedLabel = useMemo(
    () =>
      accountCreatedAt
        ? accountCreatedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '—',
    [accountCreatedAt],
  )

  const weekWindows = useMemo(() => buildWeekWindows(accountCreatedAt, now), [accountCreatedAt, now])
  const selectedWeek = useMemo(() => {
    if (weekWindows.length === 0) return null
    return weekWindows.find((week) => week.key === selectedWeekKey) ?? weekWindows[weekWindows.length - 1]
  }, [weekWindows, selectedWeekKey])

  const selectedRangeLabel = useMemo(
    () => (selectedWeek ? formatDateRange(selectedWeek.start, selectedWeek.end) : '—'),
    [selectedWeek],
  )

  const selectedHeatmapYear = useMemo(() => selectedWeek?.end.getFullYear() ?? now.getFullYear(), [selectedWeek, now])
  const { data: heatmapData, loading: heatmapLoading } = useHeatmap(selectedHeatmapYear)
  const isLoading = usageLoading || statsLoading || heatmapLoading

  const filteredDailyTokens = useMemo(() => {
    if (!selectedWeek) return []
    return (usage?.daily_tokens ?? []).filter((entry) => isWithinWeek(parseDay(entry.date), selectedWeek))
  }, [usage?.daily_tokens, selectedWeek])

  const chartData = useMemo(() => {
    if (!selectedWeek) return []
    const byDate = new Map(filteredDailyTokens.map((entry) => [entry.date, entry.tokens]))
    const points: Array<{ name: string; tokens: number; fullLabel: string }> = []
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

    for (let dayIndex = 0; dayIndex < WEEK_DAYS; dayIndex += 1) {
      const day = new Date(selectedWeek.start.getTime() + dayIndex * DAY_MS)
      const dayLabel = dayNames[dayIndex] || `Day ${dayIndex + 1}`
      const iso = toLocalDateKey(day)
      points.push({
        name: dayLabel,
        tokens: day <= selectedWeek.end ? byDate.get(iso) ?? 0 : 0,
        fullLabel: `${dayLabel} · ${day.toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}`,
      })
    }

    return points
  }, [filteredDailyTokens, selectedWeek])

  const topUsageDays = useMemo(
    () =>
      chartData
        .filter((entry) => entry.tokens > 0)
        .toSorted((left, right) => right.tokens - left.tokens)
        .slice(0, WEEK_DAYS),
    [chartData],
  )

  const weeklySessions = useMemo(() => {
    if (!selectedWeek) return []
    return (stats?.sessions ?? [])
      .filter((session) => session.created_at && isWithinWeek(new Date(session.created_at), selectedWeek))
      .toSorted((left, right) => {
        const leftTs = left.created_at ? new Date(left.created_at).getTime() : 0
        const rightTs = right.created_at ? new Date(right.created_at).getTime() : 0
        return rightTs - leftTs
      })
  }, [stats?.sessions, selectedWeek])

  const usageRows = useMemo(() => {
    const allEvents = (stats?.login_events ?? []).toSorted(
      (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
    )

    return weeklySessions
      .map((session): SessionUsageRow | null => {
        if (!session.created_at) return null
        const sessionTs = new Date(session.created_at).getTime()

        const byMachine = session.machine_id
          ? allEvents.filter(
              (event) =>
                event.machine_id === session.machine_id && new Date(event.created_at).getTime() <= sessionTs,
            )
          : []
        const byTime = allEvents.filter((event) => new Date(event.created_at).getTime() <= sessionTs)
        const matchedEvent = byMachine[byMachine.length - 1] ?? byTime[byTime.length - 1]

        const browserLabel = matchedEvent
          ? matchedEvent.login_type === 'device_code'
            ? 'Pakalon CLI'
            : matchedEvent.browser ?? matchedEvent.device_name ?? '—'
          : '—'
        const osLabel = matchedEvent?.os ?? '—'
        const browserOs = osLabel !== '—' ? `${browserLabel} / ${osLabel}` : browserLabel

        return {
          id: session.id,
          sessionId: session.id,
          userPrompt: session.prompt_text ?? '—',
          event: matchedEvent?.login_type.replace('_', ' ') ?? 'session',
          browserOs,
          timestamp: new Date(session.created_at).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          }),
          machineId: session.machine_id ?? matchedEvent?.machine_id ?? '—',
          ipAddress: matchedEvent?.ip_address ?? '—',
          tokensUsed: Math.max(0, session.current_context_tokens ?? session.tokens_used ?? 0),
          sortTs: sessionTs,
        }
      })
      .filter((row): row is SessionUsageRow => row !== null)
      .toSorted((left, right) => right.sortTs - left.sortTs)
  }, [stats?.login_events, weeklySessions])

  const paginatedRows = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage
    return usageRows.slice(startIndex, startIndex + rowsPerPage)
  }, [usageRows, currentPage])

  const totalPages = Math.ceil(usageRows.length / rowsPerPage)

  const weeklyTotalTokens = useMemo(
    () => weeklySessions.reduce((sum, session) => sum + Math.max(0, session.current_context_tokens ?? session.tokens_used ?? 0), 0),
    [weeklySessions],
  )
  const weeklyTotalSessions = weeklySessions.length
  const weeklyTotalModels = useMemo(
    () => new Set(weeklySessions.map((session) => session.model_id).filter(Boolean)).size,
    [weeklySessions],
  )

  const mergedHeatmapData = useMemo(() => {
    const baseDays = buildEmptyContributionYear(selectedHeatmapYear)
    const byDate = new Map(baseDays.map((day) => [day.date, day]))
    const usageLinesByDate = new Map(
      (usage?.daily_lines_written ?? [])
        .filter((entry) => parseDay(entry.date).getFullYear() === selectedHeatmapYear)
        .map((entry) => [entry.date, entry.lines]),
    )

    for (const day of heatmapData) {
      if (parseDay(day.date).getFullYear() !== selectedHeatmapYear) continue
      const existing = byDate.get(day.date)
      if (!existing) continue
      const merged = { ...existing, ...day }
      const total = merged.lines_added + merged.commits + merged.sessions_count + (merged.tokens_used > 0 ? 1 : 0)
      merged.level = Math.max(merged.level, calculateContributionLevel(total))
      byDate.set(day.date, merged)
    }

    for (const entry of usage?.daily_tokens ?? []) {
      if (parseDay(entry.date).getFullYear() !== selectedHeatmapYear) continue
      const existing = byDate.get(entry.date)
      if (!existing) continue
      const merged = {
        ...existing,
        tokens_used: Math.max(existing.tokens_used, entry.tokens),
        lines_added: Math.max(existing.lines_added, usageLinesByDate.get(entry.date) ?? 0),
      }
      const total = merged.lines_added + merged.commits + merged.sessions_count + (merged.tokens_used > 0 ? 1 : 0)
      merged.level = Math.max(merged.level, calculateContributionLevel(total))
      byDate.set(entry.date, merged)
    }

    return Array.from(byDate.values()).toSorted((left, right) => left.date.localeCompare(right.date))
  }, [heatmapData, selectedHeatmapYear, usage?.daily_lines_written, usage?.daily_tokens])

  const heatmapWeeks = useMemo(() => buildHeatmapWeeks(mergedHeatmapData), [mergedHeatmapData])
  const heatmapSummary = useMemo(
    () =>
      mergedHeatmapData.reduce(
        (summary, day) => ({
          activeDays: summary.activeDays + (day.level > 0 ? 1 : 0),
          linesAdded: summary.linesAdded + day.lines_added,
          linesDeleted: summary.linesDeleted + day.lines_deleted,
          tokensUsed: summary.tokensUsed + day.tokens_used,
        }),
        { activeDays: 0, linesAdded: 0, linesDeleted: 0, tokensUsed: 0 },
      ),
    [mergedHeatmapData],
  )

  const fmt = (value: number | null) => (value === null ? '—' : value.toLocaleString())
  const dashboardRef = useRef<HTMLDivElement>(null)

  const handleExport = async () => {
    if (!dashboardRef.current) return

    setIsExporting(true)
    setExportError(null)

    try {
      const html2canvas = (await import('html2canvas')).default
      const { jsPDF } = await import('jspdf')

      const canvas = await html2canvas(dashboardRef.current, { scale: 2, useCORS: true, backgroundColor: '#0e0e0b' })
      const imgData = canvas.toDataURL('image/png')

      const pdf = new jsPDF('p', 'pt', 'a4')
      const pdfWidth = pdf.internal.pageSize.getWidth()
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width

      if (pdfHeight > pdf.internal.pageSize.getHeight()) {
        let heightLeft = pdfHeight
        let position = 0
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight)
        heightLeft -= pdf.internal.pageSize.getHeight()
        while (heightLeft >= 0) {
          position = heightLeft - pdfHeight
          pdf.addPage()
          pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight)
          heightLeft -= pdf.internal.pageSize.getHeight()
        }
      } else {
        pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight)
      }

      const weekTag = selectedWeek ? `week-${selectedWeek.index}` : 'week'
      pdf.save(`pakalon-overview-${weekTag}-${toDateInputValue(now)}.pdf`)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Could not export overview as PDF.')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div ref={dashboardRef} className="p-8 space-y-8 bg-[#0e0e0b]">
      {(usageError || statsError) && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm flex items-center gap-2">
          <span className="material-symbols-outlined text-lg">warning</span>
          Unable to load overview data — please refresh the page.
        </div>
      )}

      {exportError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm flex items-center gap-2">
          <span className="material-symbols-outlined text-lg">picture_as_pdf</span>
          {exportError}
        </div>
      )}

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-3xl font-bold tracking-tight">Usage Overview</h2>
          <p className="text-[#b1b4a2] text-sm">
            {isLoading ? 'Loading...' : `Track your AI command activity and token consumption for ${selectedRangeLabel}.`}
          </p>
          <p className="text-[#8f937c] text-xs">Account created: {accountCreatedLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedWeek?.key ?? ''}
            onChange={(event) => setSelectedWeekKey(event.target.value)}
            disabled={weekWindows.length === 0}
            className="bg-[#25261e] border border-border-dark text-white text-sm rounded-lg px-3 py-2 outline-none min-w-[320px] disabled:opacity-50"
          >
            {weekWindows.length === 0 ? (
              <option value="">No weeks available</option>
            ) : (
              weekWindows.map((week) => (
                <option key={week.key} value={week.key}>
                  {week.label}
                </option>
              ))
            )}
          </select>
          <div className="text-xs text-[#b1b4a2]">Week window: {selectedRangeLabel}</div>
          <button
            onClick={handleExport}
            disabled={isExporting || isLoading}
            className="flex items-center gap-2 bg-primary hover:bg-primary-hover disabled:opacity-60 disabled:cursor-not-allowed text-[#1d1e14] text-sm font-bold py-2 px-4 rounded-lg transition-colors"
          >
            <span className="material-symbols-outlined text-lg">download</span>
            {isExporting ? 'Exporting PDF…' : 'Export PDF'}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#1a1b16] border border-border-dark rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <span className="material-symbols-outlined text-primary">token</span>
            <span className="text-[#b1b4a2] text-sm font-medium">Tokens Used (Week)</span>
          </div>
          <p className="text-3xl font-bold">{fmt(statsLoading ? null : weeklyTotalTokens)}</p>
        </div>
        <div className="bg-[#1a1b16] border border-border-dark rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <span className="material-symbols-outlined text-primary">chat</span>
            <span className="text-[#b1b4a2] text-sm font-medium">Sessions (Week)</span>
          </div>
          <p className="text-3xl font-bold">{fmt(statsLoading ? null : weeklyTotalSessions)}</p>
        </div>
        <div className="bg-[#1a1b16] border border-border-dark rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <span className="material-symbols-outlined text-primary">model_training</span>
            <span className="text-[#b1b4a2] text-sm font-medium">Models Used (Week)</span>
          </div>
          <p className="text-3xl font-bold">{fmt(statsLoading ? null : weeklyTotalModels)}</p>
        </div>
        <div className="bg-[#1a1b16] border border-border-dark rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <span className="material-symbols-outlined text-primary">event_note</span>
            <span className="text-[#b1b4a2] text-sm font-medium">Events (Week)</span>
          </div>
          <p className="text-3xl font-bold">{fmt(statsLoading ? null : usageRows.length)}</p>
        </div>
      </div>

      <div className="bg-[#1a1b16] border border-border-dark rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Contribution Activity</h3>
          <span className="text-[#b1b4a2] text-sm">Live backend data · {selectedHeatmapYear}</span>
        </div>
        <div className="flex gap-1 overflow-x-auto pb-2">
          {heatmapWeeks.map((week) => (
            <div key={week.key} className="flex flex-col gap-1 flex-1 min-w-[12px]">
              {week.days.map((day, idx) => (
                <div
                  key={`${week.key}-${idx}`}
                  className={`w-3 h-3 rounded-sm ${day ? getContributionColor(day.level) : 'bg-transparent'}`}
                  title={getContributionTitle(day)}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[#b1b4a2]">
          <div className="flex items-center gap-2">
            <span>Less</span>
            {[0, 1, 2, 3, 4].map((level) => (
              <div key={level} className={`w-3 h-3 rounded-sm ${getContributionColor(level)}`} />
            ))}
            <span>More</span>
          </div>
          <span>
            {heatmapSummary.activeDays.toLocaleString()} active days · {formatCompactTokens(heatmapSummary.tokensUsed)} tokens
          </span>
        </div>
      </div>

      <div className="bg-[#1a1b16] border border-border-dark rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-1">Token Usage</h3>
        <p className="text-xs text-[#b1b4a2] mb-4">Y-axis: tokens used · X-axis: Day 1 to Day 7 of selected week</p>
        <div className="h-64">
          <TokenUsageChart data={chartData} />
        </div>
        <div className="mt-6">
          <h4 className="text-sm font-semibold text-white mb-3">Highest Token Days (Selected Week)</h4>
          {topUsageDays.length === 0 ? (
            <p className="text-[#b1b4a2] text-sm">No token usage recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-dark">
                    <th className="text-left text-[#b1b4a2] font-medium pb-2 pr-4">Day</th>
                    <th className="text-left text-[#b1b4a2] font-medium pb-2">Tokens</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-dark">
                  {topUsageDays.map((day) => (
                    <tr key={day.fullLabel}>
                      <td className="py-2 pr-4 text-white">{day.fullLabel}</td>
                      <td className="py-2 text-[#b1b4a2]">{day.tokens.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="bg-[#1a1b16] border border-border-dark rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">devices</span>
            <h3 className="text-lg font-semibold">Session and Token Usage</h3>
          </div>
          <span className="text-[#b1b4a2] text-sm">{selectedWeek ? selectedWeek.label : 'No week selected'}</span>
        </div>
        {statsLoading ? (
          <p className="text-[#b1b4a2] text-sm">Loading…</p>
        ) : usageRows.length === 0 ? (
          <p className="text-[#b1b4a2] text-sm">No session usage rows recorded in this week.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-dark">
                  <th className="text-left text-[#b1b4a2] font-medium pb-3 pr-4">Session ID</th>
                  <th className="text-left text-[#b1b4a2] font-medium pb-3 pr-4">User Prompt</th>
                  <th className="text-left text-[#b1b4a2] font-medium pb-3 pr-4">Event</th>
                  <th className="text-left text-[#b1b4a2] font-medium pb-3 pr-4">Browser/OS</th>
                  <th className="text-left text-[#b1b4a2] font-medium pb-3 pr-4">Timestamp</th>
                  <th className="text-left text-[#b1b4a2] font-medium pb-3 pr-4">Machine ID</th>
                  <th className="text-left text-[#b1b4a2] font-medium pb-3 pr-4">IP Address</th>
                  <th className="text-left text-[#b1b4a2] font-medium pb-3">Token Usage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-dark">
                {paginatedRows.map((row) => (
                  <tr key={row.id} className="hover:bg-[#25261e]/50 transition-colors">
                    <td className="py-3 pr-4 text-[#b1b4a2] font-mono text-xs" title={row.sessionId}>
                      {row.sessionId.slice(0, 8)}…
                    </td>
                    <td className="py-3 pr-4 text-white max-w-[200px] truncate" title={row.userPrompt}>
                      {row.userPrompt.length > 50 ? `${row.userPrompt.slice(0, 50)}…` : row.userPrompt}
                    </td>
                    <td className="py-3 pr-4 text-[#b1b4a2] text-xs uppercase tracking-wide">{row.event}</td>
                    <td className="py-3 pr-4 text-white">{row.browserOs}</td>
                    <td className="py-3 pr-4 text-[#b1b4a2] text-xs whitespace-nowrap">{row.timestamp}</td>
                    <td className="py-3 pr-4 text-[#b1b4a2] font-mono text-xs" title={row.machineId !== '—' ? row.machineId : undefined}>
                      {row.machineId !== '—' ? `${row.machineId.slice(0, 24)}${row.machineId.length > 24 ? '…' : ''}` : '—'}
                    </td>
                    <td className="py-3 pr-4 text-[#b1b4a2] font-mono text-xs">{row.ipAddress}</td>
                    <td className="py-3 text-[#d7e19d] font-semibold">{row.tokensUsed.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-border-dark">
                <div className="text-xs text-[#b1b4a2]">
                  Showing {(currentPage - 1) * rowsPerPage + 1} to {Math.min(currentPage * rowsPerPage, usageRows.length)} of {usageRows.length} sessions
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1 text-xs bg-[#25261e] border border-border-dark rounded disabled:opacity-50 hover:bg-[#2f3028] transition-colors"
                  >
                    Previous
                  </button>
                  <span className="text-xs text-[#b1b4a2]">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 text-xs bg-[#25261e] border border-border-dark rounded disabled:opacity-50 hover:bg-[#2f3028] transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

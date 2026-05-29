'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { AutomationsShell, statusPill } from '@/components/automations/AutomationsShell'
import { useAutomations, useAutomationConnectors, useAutomationCronJobs, useAutomationLogs } from '@/lib/api'

interface InboxItem {
  id: string
  automation_id: string
  execution_id: string | null
  title: string
  body: string | null
  severity: string
  category: string
  result_data: Record<string, unknown>
  action_url: string | null
  is_read: boolean
  is_archived: boolean
  is_starred: boolean
  created_at: string
  read_at: string | null
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function AutomationInboxPage() {
  const { automations } = useAutomations()
  const { catalog } = useAutomationConnectors()
  const { cronJobs } = useAutomationCronJobs()
  const { logs } = useAutomationLogs()

  const [items, setItems] = useState<InboxItem[]>([])
  const [counts, setCounts] = useState({ total: 0, unread: 0, starred: 0 })
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'unread' | 'starred'>('all')
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = localStorage.getItem('pakalon_token')
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}

        const unreadParam = filter === 'unread' ? '&unread_only=true' : ''
        const [inboxRes, countsRes] = await Promise.all([
          fetch(`${API_BASE}/automations/inbox?limit=50${unreadParam}`, { headers }),
          fetch(`${API_BASE}/automations/inbox/counts`, { headers }),
        ])

        if (inboxRes.ok) {
          const data = await inboxRes.json()
          let filteredItems = data.items || []
          if (filter === 'starred') {
            filteredItems = filteredItems.filter((i: InboxItem) => i.is_starred)
          }
          setItems(filteredItems)
          setCounts(data.counts || { total: 0, unread: 0, starred: 0 })
        }
        if (countsRes.ok) {
          setCounts(await countsRes.json())
        }
      } catch {
        // silent
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [filter, tick])

  const handleMarkRead = async (itemId: string) => {
    const token = localStorage.getItem('pakalon_token')
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
    await fetch(`${API_BASE}/automations/inbox/${itemId}/read`, {
      method: 'POST',
      headers,
    })
    refetch()
  }

  const handleMarkAllRead = async () => {
    const token = localStorage.getItem('pakalon_token')
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
    await fetch(`${API_BASE}/automations/inbox/read-all`, {
      method: 'POST',
      headers,
    })
    refetch()
  }

  const handleArchive = async (itemId: string) => {
    const token = localStorage.getItem('pakalon_token')
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
    await fetch(`${API_BASE}/automations/inbox/${itemId}/archive`, {
      method: 'POST',
      headers,
    })
    refetch()
  }

  const handleStar = async (itemId: string) => {
    const token = localStorage.getItem('pakalon_token')
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
    await fetch(`${API_BASE}/automations/inbox/${itemId}/star`, {
      method: 'POST',
      headers,
    })
    refetch()
  }

  const severityIcon: Record<string, string> = {
    info: '[i]',
    warning: 'Warning:',
    error: '[X]',
    critical: '[Siren]',
  }

  const severityColors: Record<string, string> = {
    info: 'border-blue-500/20 bg-blue-500/5',
    warning: 'border-yellow-500/20 bg-yellow-500/5',
    error: 'border-red-500/20 bg-red-500/5',
    critical: 'border-red-500/40 bg-red-500/10',
  }

  return (
    <AutomationsShell
      title="Inbox"
      description="Workflow results and alerts that need your attention. Similar to Cursor's results inbox."
      stats={{
        automations: automations.length,
        connectedApps: catalog?.connected.length ?? 0,
        cronJobs: cronJobs.length,
        logs: logs.length,
      }}
    >
      <div className="space-y-6">
        {/* Filter tabs and actions */}
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {(['all', 'unread', 'starred'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-lg px-4 py-2 text-sm transition-colors ${
                  filter === f
                    ? 'bg-primary/10 text-primary border border-primary/30'
                    : 'border border-border-dark text-[#b1b4a2] hover:text-white hover:border-white/10'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
                {f === 'unread' && counts.unread > 0 && (
                  <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-background-dark">
                    {counts.unread}
                  </span>
                )}
              </button>
            ))}
          </div>
          {counts.unread > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="text-sm text-[#b1b4a2] hover:text-white"
            >
              Mark all as read
            </button>
          )}
        </div>

        {/* Inbox items */}
        <div className="space-y-3">
          {loading && <p className="text-[#b1b4a2]">Loading inbox...</p>}

          {!loading && items.length === 0 && (
            <div className="rounded-xl border border-dashed border-border-dark px-6 py-12 text-center">
              <span className="material-symbols-outlined text-4xl text-[#8f937c]">inbox</span>
              <p className="mt-3 text-[#b1b4a2]">
                {filter === 'unread' ? 'No unread items.' : filter === 'starred' ? 'No starred items.' : 'Your inbox is empty.'}
              </p>
              <p className="mt-1 text-sm text-[#8f937c]">
                Workflow results that need attention will appear here.
              </p>
            </div>
          )}

          {items.map((item) => {
            const automation = automations.find(a => a.id === item.automation_id)
            return (
              <div
                key={item.id}
                className={`rounded-xl border p-4 transition-colors ${
                  item.is_read ? 'border-border-dark bg-background-dark' : `${severityColors[item.severity] || 'border-border-dark bg-surface-dark'} border-l-2`
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span>{severityIcon[item.severity] || '[Clipboard]'}</span>
                      <h3 className={`text-sm font-medium ${item.is_read ? 'text-[#b1b4a2]' : 'text-white'}`}>
                        {item.title}
                      </h3>
                      {!item.is_read && (
                        <span className="h-2 w-2 rounded-full bg-primary" />
                      )}
                    </div>
                    {item.body && (
                      <p className="mt-1 text-sm text-[#8f937c] line-clamp-2">{item.body}</p>
                    )}
                    <div className="mt-2 flex items-center gap-3 text-xs text-[#8f937c]">
                      <span>{automation?.name || 'Unknown workflow'}</span>
                      <span>•</span>
                      <span>{new Date(item.created_at).toLocaleString()}</span>
                      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${statusPill(item.severity === 'critical' ? 'failed' : item.severity === 'warning' ? 'paused' : 'success')}`}>
                        {item.category}
                      </span>
                    </div>
                    {item.result_data && Object.keys(item.result_data).length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-[#8f937c] hover:text-white">
                          View details
                        </summary>
                        <pre className="mt-1 overflow-x-auto rounded-lg bg-[#11120d] p-2 text-xs text-[#b1b4a2]">
                          {JSON.stringify(item.result_data, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    {!item.is_read && (
                      <button
                        type="button"
                        onClick={() => handleMarkRead(item.id)}
                        className="rounded-lg p-1.5 text-[#8f937c] hover:bg-white/5 hover:text-white"
                        title="Mark as read"
                      >
                        <span className="material-symbols-outlined text-[16px]">done</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleStar(item.id)}
                      className="rounded-lg p-1.5 hover:bg-white/5"
                      title="Star"
                    >
                      <span className={`material-symbols-outlined text-[16px] ${item.is_starred ? 'text-yellow-400' : 'text-[#8f937c]'}`}>
                        {item.is_starred ? 'star' : 'star_outline'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleArchive(item.id)}
                      className="rounded-lg p-1.5 text-[#8f937c] hover:bg-white/5 hover:text-white"
                      title="Archive"
                    >
                      <span className="material-symbols-outlined text-[16px]">archive</span>
                    </button>
                    {item.action_url && (
                      <a
                        href={item.action_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg p-1.5 text-[#8f937c] hover:bg-white/5 hover:text-white"
                        title="Open link"
                      >
                        <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                      </a>
                    )}
                    {item.execution_id && (
                      <Link
                        href={`/dashboard/automations/editor/${item.automation_id}/executions/${item.execution_id}`}
                        className="rounded-lg p-1.5 text-[#8f937c] hover:bg-white/5 hover:text-white"
                        title="View execution"
                      >
                        <span className="material-symbols-outlined text-[16px]">history</span>
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </AutomationsShell>
  )
}

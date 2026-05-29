'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'

const navigationItems = [
  { href: '/dashboard/automations', label: 'Automations', icon: 'bolt' },
  { href: '/dashboard/automations/connectors', label: 'Connectors', icon: 'hub' },
  { href: '/dashboard/automations/cron-jobs', label: 'Cron jobs', icon: 'schedule' },
  { href: '/dashboard/automations/logs', label: 'Logs', icon: 'receipt_long' },
  { href: '/dashboard/automations/inbox', label: 'Inbox', icon: 'inbox' },
]

type Stats = {
  automations: number
  connectedApps: number
  cronJobs: number
  logs: number
}

const providerBadgeStyles: Record<string, string> = {
  github: 'from-slate-300 to-slate-500 text-slate-950',
  slack: 'from-fuchsia-400 to-violet-500 text-white',
  gitlab: 'from-orange-400 to-rose-500 text-white',
  discord: 'from-indigo-400 to-blue-500 text-white',
  notion: 'from-zinc-200 to-zinc-400 text-zinc-950',
  linear: 'from-violet-300 to-violet-500 text-violet-950',
  jira: 'from-sky-300 to-blue-500 text-blue-950',
  'google-sheets': 'from-emerald-300 to-emerald-500 text-emerald-950',
  'google-calendar': 'from-cyan-300 to-sky-500 text-sky-950',
  trello: 'from-sky-300 to-cyan-500 text-sky-950',
  asana: 'from-pink-300 to-fuchsia-500 text-fuchsia-950',
  figma: 'from-orange-300 to-rose-500 text-rose-950',
  stripe: 'from-violet-300 to-indigo-500 text-indigo-950',
  pagerduty: 'from-emerald-300 to-lime-500 text-lime-950',
}

function isActivePath(pathname: string, href: string) {
  if (href === '/dashboard/automations') {
    return pathname === href
  }
  return pathname === href || pathname.startsWith(`${href}/`)
}

function getProviderMonogram(provider: string, displayName: string) {
  const compactProvider = provider
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)

  if (compactProvider.length >= 2) {
    return compactProvider.toUpperCase()
  }

  return displayName.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'PK'
}

export function statusPill(status?: string | null) {
  switch ((status ?? '').toLowerCase()) {
    case 'success':
    case 'connected':
    case 'enabled':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20'
    case 'failed':
      return 'bg-red-500/15 text-red-300 border-red-500/20'
    case 'paused':
    case 'disabled':
      return 'bg-yellow-500/15 text-yellow-300 border-yellow-500/20'
    default:
      return 'bg-white/5 text-[#d7dac8] border-white/10'
  }
}

export function ConnectorLogo({ provider, displayName, logoUrl }: { provider: string; displayName: string; logoUrl?: string | null }) {
  const [imageFailed, setImageFailed] = useState(false)
  useEffect(() => {
    setImageFailed(false)
  }, [logoUrl])

  if (logoUrl && !imageFailed) {
    return (
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/30 p-2 shadow-lg shadow-black/20">
        <img
          src={logoUrl}
          alt={`${displayName} logo`}
          className="h-8 w-8 object-contain"
          loading="lazy"
          onError={() => setImageFailed(true)}
        />
      </div>
    )
  }

  const gradient = providerBadgeStyles[provider] ?? 'from-[#d4d6ca] to-[#7a7f67] text-[#11120d]'

  return (
    <div className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${gradient} shadow-lg shadow-black/20`}>
      <span className="text-sm font-black tracking-[0.16em]">{getProviderMonogram(provider, displayName)}</span>
    </div>
  )
}

export function AutomationsShell({
  title,
  description,
  stats,
  banner,
  children,
}: {
  title: string
  description: string
  stats: Stats
  banner?: string | null
  children: ReactNode
}) {
  const pathname = usePathname()

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-8 lg:p-12">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-white">{title}</h1>
          <p className="max-w-3xl text-[#b1b4a2]">{description}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-border-dark bg-surface-dark px-4 py-3">
              <p className="text-xs uppercase tracking-wider text-[#8f937c]">Automations</p>
              <p className="text-2xl font-bold text-white">{stats.automations}</p>
            </div>
            <div className="rounded-xl border border-border-dark bg-surface-dark px-4 py-3">
              <p className="text-xs uppercase tracking-wider text-[#8f937c]">Connected apps</p>
              <p className="text-2xl font-bold text-white">{stats.connectedApps}</p>
            </div>
            <div className="rounded-xl border border-border-dark bg-surface-dark px-4 py-3">
              <p className="text-xs uppercase tracking-wider text-[#8f937c]">Cron jobs</p>
              <p className="text-2xl font-bold text-white">{stats.cronJobs}</p>
            </div>
            <div className="rounded-xl border border-border-dark bg-surface-dark px-4 py-3">
              <p className="text-xs uppercase tracking-wider text-[#8f937c]">Logs</p>
              <p className="text-2xl font-bold text-white">{stats.logs}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 rounded-2xl border border-border-dark bg-surface-dark p-3">
        {navigationItems.map((item) => {
          const active = isActivePath(pathname, item.href)

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm transition-all ${
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border-dark text-[#b1b4a2] hover:border-white/10 hover:text-white'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </div>

      {banner && (
        <div className="rounded-xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary">
          {banner}
        </div>
      )}

      {children}
    </div>
  )
}

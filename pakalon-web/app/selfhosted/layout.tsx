'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bot, MessageSquare, Layers3, Menu, X } from 'lucide-react'

type NavItem = {
  label: string
  href: string
  icon: typeof Layers3
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

function SelfHostedSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()

  const items = useMemo<NavItem[]>(
    () => [
      { label: 'Models', href: '/selfhosted/models', icon: Layers3 },
      { label: 'Chat', href: '/selfhosted/chat', icon: MessageSquare },
    ],
    [],
  )

  return (
    <aside className="flex h-full w-72 flex-col border-r border-border-dark bg-[#11120d] p-4">
      <div className="flex items-center gap-3 rounded-2xl border border-border-dark bg-[#1a1b16] px-4 py-4 shadow-[0_0_0_1px_rgba(215,225,157,0.03)]">
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Bot className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.24em] text-[#8f937c]">Self-hosted</p>
          <p className="truncate text-sm font-semibold text-white">Pakalon Local Dashboard</p>
        </div>
      </div>

      <nav className="mt-6 flex flex-col gap-2">
        {items.map((item) => {
          const Icon = item.icon
          const active = isActive(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
                active
                  ? 'border-primary/20 bg-primary/10 text-primary'
                  : 'border-transparent text-[#b1b4a2] hover:border-border-dark hover:bg-[#25261e] hover:text-white'
              }`}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="mt-auto rounded-2xl border border-border-dark bg-[#1a1b16] p-4 text-sm text-[#b1b4a2]">
        <p className="font-medium text-white">Local-only mode</p>
        <p className="mt-1 leading-6">
          Connects to Ollama or LM Studio through the local Pakalon API. No auth required.
        </p>
      </div>
    </aside>
  )
}

export default function SelfHostedLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="flex min-h-screen bg-background-dark text-white">
      <div className="hidden lg:block">
        <SelfHostedSidebar />
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close self-hosted navigation"
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-80 max-w-[85vw] shadow-2xl shadow-black/40">
            <SelfHostedSidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border-dark bg-[#11120d] px-4 py-4 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="inline-flex size-10 items-center justify-center rounded-lg border border-border-dark bg-[#1a1b16] text-white transition-colors hover:bg-[#25261e]"
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </button>
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Bot className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.24em] text-[#8f937c]">Self-hosted</p>
              <p className="truncate text-sm font-semibold text-white">Pakalon Local Dashboard</p>
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto bg-background-dark">{children}</main>
      </div>
    </div>
  )
}

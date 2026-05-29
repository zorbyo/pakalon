'use client'

import React, { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

interface HeadingItem {
  id: string
  text: string
  level: number
}

interface DocsSidebarProps {
  headings: HeadingItem[]
  currentMode: 'offline' | 'online'
}

interface SearchItem {
  title: string
  category: 'Core CLI' | 'Agent System'
  desc: string
  href: string
  keywords: string[]
}

const SEARCH_DATASET: SearchItem[] = [
  // Core CLI (Offline)
  { title: 'Overview', category: 'Core CLI', desc: 'Overview of Pakalon CLI editor, key capabilities and tech stacks.', href: '/docs/not-initialized#overview', keywords: ['about', 'intro', 'editor', 'features'] },
  { title: 'System Architecture', category: 'Core CLI', desc: 'Topology diagram connecting CLI, web, backend, and Python bridge.', href: '/docs/not-initialized#architecture', keywords: ['diagram', 'flow', 'bridge', 'db'] },
  { title: 'Dual-Mode Config', category: 'Core CLI', desc: 'Cloud mode (Polar billing, OpenRouter) vs Self-hosted mode (SQLite).', href: '/docs/not-initialized#dual-mode-architecture', keywords: ['saas', 'ollama', 'local', 'polar'] },
  { title: 'Installation Guide', category: 'Core CLI', desc: 'Global install via npm/bun, CLI doctor diagnostics check.', href: '/docs/not-initialized#installation', keywords: ['npm', 'bun', 'doctor', 'setup', 'clone'] },
  { title: 'Authentication Flow', category: 'Core CLI', desc: 'Device code authentication flow, JWT signatures and token lifespan.', href: '/docs/not-initialized#authentication', keywords: ['login', 'jwt', 'security', 'key', 'supabase'] },
  { title: 'CLI Commands List', category: 'Core CLI', desc: 'Detailed table of top-level terminal subcommands and flags.', href: '/docs/not-initialized#cli-commands', keywords: ['terminal', 'bash', 'run', 'doctor', 'status'] },
  { title: 'Slash Commands', category: 'Core CLI', desc: 'Commands available in interactive chat (/undo, /plan, /penpot, /clear).', href: '/docs/not-initialized#slash-commands', keywords: ['undo', 'chat', 'repl', 'exit'] },
  { title: 'Chat Mode', category: 'Core CLI', desc: 'Streaming responses, interactive repl keyboard shortcuts, and file snapshots.', href: '/docs/not-initialized#chat-mode', keywords: ['keyboard', 'compaction', 'undo', 'snapshot'] },
  { title: '6-Phase Agent Pipeline', category: 'Core CLI', desc: 'Autonomous build pipeline overview, HIL and YOLO permissions.', href: '/docs/not-initialized#agent-mode-6-phase-pipeline', keywords: ['yolo', 'hil', 'autonomous', 'workflow'] },
  { title: 'LSP Integration', category: 'Core CLI', desc: 'Language Server Protocol, definitions, references hover, and diagnostics.', href: '/docs/not-initialized#lsp-integration', keywords: ['typescript', 'pyright', 'diagnostics', 'autocomplete'] },
  { title: 'MCP Server Support', category: 'Core CLI', desc: 'Model Context Protocol server lists, SSE transports, and tools.', href: '/docs/not-initialized#mcp-server-support', keywords: ['sse', 'tools', 'mcp', 'context'] },
  { title: 'Penpot Design Sync', category: 'Core CLI', desc: 'Docker Penpot compose configuration and sync.js file watching.', href: '/docs/not-initialized#penpot-design-integration', keywords: ['svg', 'figma', 'wireframes', 'mockups'] },
  { title: 'Security Scanner Tools', category: 'Core CLI', desc: '15+ SAST/DAST security scanning tools (Semgrep, Gitleaks, ZAP).', href: '/docs/not-initialized#security-features', keywords: ['vulnerability', 'scan', 'zap', 'semgrep', 'bandit'] },
  { title: 'Self-Hosted Setup', category: 'Core CLI', desc: 'Deploying locally with Ollama, LM Studio, and docker-compose files.', href: '/docs/not-initialized#self-hosted-mode', keywords: ['local', 'ollama', 'docker', 'sqlite', 'offline'] },

  // Agent System (Online)
  { title: 'Agent System Overview', category: 'Agent System', desc: 'Multi-agent orchestration orchestrator, tool schemas, and worktrees.', href: '/docs/initialized#agent-system-overview', keywords: ['orchestration', 'swarm', 'worktrees'] },
  { title: 'Specialist Agent Types', category: 'Agent System', desc: 'Built-in (Explore, Plan, Verification), Custom, Plugin, and Fork agents.', href: '/docs/initialized#agent-types', keywords: ['explore', 'custom', 'plugin', 'fork'] },
  { title: 'Agent Configuration', category: 'Agent System', desc: 'Setting effort levels (low-max) and permission modes (acceptEdits, bypass).', href: '/docs/initialized#agent-configuration', keywords: ['effort', 'permissions', 'yolo', 'bypass'] },
  { title: 'Agent Tool System', category: 'Agent System', desc: 'Core tools permitted for agents, async background allowed operations.', href: '/docs/initialized#agent-tool-system', keywords: ['read', 'write', 'bash', 'grep', 'mcp'] },
  { title: 'Agent Worktree Isolation', category: 'Agent System', desc: 'Git worktree isolate environments and remote workspace runners.', href: '/docs/initialized#agent-isolation', keywords: ['git', 'branch', 'worktree', 'sandbox'] },
  { title: 'Persistent Memory', category: 'Agent System', desc: 'Mem0 SQLite SQLite DB storage, FTS5 search, and auto-dreaming.', href: '/docs/initialized#agent-memory', keywords: ['mem0', 'sqlite', 'learning', 'vector'] },
  { title: 'Phase 1: Planning', category: 'Agent System', desc: 'Research phase generating spec.md, plan.md, and CLAUDE.md guidelines.', href: '/docs/initialized#phase-1-planning', keywords: ['planning', 'claude.md', 'spec'] },
  { title: 'Phase 2: Wireframes', category: 'Agent System', desc: 'Wireframe mapping inside Penpot and JSON layouts export.', href: '/docs/initialized#phase-2-wireframes', keywords: ['penpot', 'layout', 'design'] },
  { title: 'Phase 3: Frontend', category: 'Agent System', desc: 'Shadcn component builder and 5 development subagents.', href: '/docs/initialized#phase-3-frontend-development', keywords: ['components', 'subagents', 'react'] },
  { title: 'Phase 4: Security QA', category: 'Agent System', desc: 'SAST/DAST feedback loops sending issues to agents for auto-fixing.', href: '/docs/initialized#phase-4-security-qa', keywords: ['semgrep', 'zap', 'feedback', 'scanning'] },
  { title: 'Phase 5: CI/CD PR', category: 'Agent System', desc: 'GitHub Actions workflows generation and automatic pull requests.', href: '/docs/initialized#phase-5-cicd', keywords: ['github', 'actions', 'deploy', 'pr'] },
  { title: 'Security Feedback Loop', category: 'Agent System', desc: 'Vulnerability scan iterations fixing errors automatically in code.', href: '/docs/initialized#security-feedback-loop', keywords: ['fix', 'sast', 'dast', 'vulnerabilities'] },
  { title: 'Agent API Reference', category: 'Agent System', desc: 'TypeScript parameters, Spawning subagents triggers and interfaces.', href: '/docs/initialized#agent-api-reference', keywords: ['typescript', 'api', 'spawn', 'subagent'] },
]

export default function DocsSidebar({ headings, currentMode }: DocsSidebarProps) {
  const router = useRouter()
  const pathname = usePathname()

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchItem[]>([])
  const [activeSection, setActiveSection] = useState('')
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [isSearchFocused, setIsSearchFocused] = useState(false)

  const searchRef = useRef<HTMLDivElement>(null)

  // Scroll spy observer to highlight active TOC heading
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visibleHeadings = entries.filter((e) => e.isIntersecting)
        if (visibleHeadings.length > 0) {
          visibleHeadings.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
          setActiveSection(visibleHeadings[0].target.id)
        }
      },
      {
        rootMargin: '-80px 0px -60% 0px',
        threshold: 0.1,
      }
    )

    headings.forEach((h) => {
      const el = document.getElementById(h.id)
      if (el) observer.observe(el)
    })

    return () => {
      headings.forEach((h) => {
        const el = document.getElementById(h.id)
        if (el) observer.unobserve(el)
      })
    }
  }, [headings])

  // Search logic
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }

    const query = searchQuery.toLowerCase().trim()
    const filtered = SEARCH_DATASET.filter((item) => {
      return (
        item.title.toLowerCase().includes(query) ||
        item.desc.toLowerCase().includes(query) ||
        item.keywords.some((k) => k.toLowerCase().includes(query))
      )
    })
    setSearchResults(filtered)
  }, [searchQuery])

  // Close search results overlay when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsSearchFocused(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleModeSwitch = (mode: 'offline' | 'online') => {
    if (mode === 'offline') {
      router.push('/docs/not-initialized')
    } else {
      router.push('/docs/initialized')
    }
    setIsMobileOpen(false)
  }

  const handleSearchClick = (href: string) => {
    setSearchQuery('')
    setIsSearchFocused(false)
    setIsMobileOpen(false)
    router.push(href)
  }

  const filteredHeadings = headings.filter((h) => h.level === 2 || h.level === 3)

  return (
    <>
      {/* Mobile Header (Sticky top bar for tablet/mobile viewports) */}
      <div className="lg:hidden sticky top-0 z-40 w-full flex items-center justify-between bg-[#11120d]/90 backdrop-blur border-b border-border-dark px-4 py-3 text-white">
        <div className="flex items-center gap-2.5">
          <span className="font-bold text-white tracking-tight">Pakalon Docs</span>
          <span className="text-[10px] font-mono bg-primary/20 text-primary border border-primary/30 px-2 py-0.5 rounded-full uppercase tracking-wider">
            {currentMode === 'offline' ? 'Not Initialized' : 'Initialized'}
          </span>
        </div>
        <button
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          className="p-1.5 rounded-lg border border-border-dark bg-[#1d1e18] text-[#b1b4a2] hover:text-white"
          aria-label="Open documentation navigation menu"
        >
          <span className="material-symbols-outlined text-lg">
            {isMobileOpen ? 'close' : 'menu'}
          </span>
        </button>
      </div>

      {/* Sidebar Container */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 border-r border-border-dark bg-[#11120d] p-5 flex flex-col justify-between h-full transform transition-transform duration-300 lg:sticky lg:translate-x-0 ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:flex'
        }`}
      >
        <div className="flex flex-col gap-5 overflow-y-hidden h-full">
          {/* Logo & Brand Header */}
          <div className="flex items-center gap-3 border-b border-white/5 pb-3">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="size-8 rounded-lg bg-primary flex items-center justify-center">
                <span className="material-symbols-outlined text-background-dark font-bold text-lg">menu_book</span>
              </div>
              <div>
                <span className="font-bold text-white text-[15px] tracking-tight">Pakalon Docs</span>
                <p className="text-[9px] font-mono text-primary/80 tracking-wide leading-none mt-0.5 uppercase">Reference Manual</p>
              </div>
            </Link>
          </div>

          {/* Localized Fuzzy Search */}
          <div ref={searchRef} className="relative">
            <div className="relative">
              <span className="material-symbols-outlined text-[#b1b4a2] absolute left-3 top-2.5 text-base">search</span>
              <input
                type="text"
                placeholder="Search topics, variables..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                className="w-full bg-[#1d1e18] border border-border-dark rounded-lg pl-9 pr-4 py-2 text-xs text-white placeholder-[#b1b4a2]/50 focus:outline-none focus:border-primary/50 transition-all font-light"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-2.5 text-[#b1b4a2] hover:text-white"
                  aria-label="Clear search query"
                >
                  <span className="material-symbols-outlined text-xs">close</span>
                </button>
              )}
            </div>

            {/* Float Overlay Results Search */}
            {isSearchFocused && searchQuery.trim() && (
              <div className="absolute left-0 right-0 top-full mt-2 bg-[#1d1e18] border border-border-dark rounded-xl shadow-[0_12px_24px_rgba(0,0,0,0.5)] max-h-72 overflow-y-auto z-50 p-2 divide-y divide-white/5 backdrop-blur-md">
                {searchResults.length > 0 ? (
                  searchResults.map((item, index) => (
                    <button
                      key={index}
                      onClick={() => handleSearchClick(item.href)}
                      className="w-full text-left p-2.5 hover:bg-white/5 rounded-lg transition-colors flex flex-col gap-1 first:mt-0"
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="text-white text-xs font-semibold tracking-tight">{item.title}</span>
                        <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded uppercase tracking-widest ${
                          item.category === 'Core CLI'
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : 'bg-primary/10 text-primary border border-primary/20'
                        }`}>
                          {item.category}
                        </span>
                      </div>
                      <p className="text-[10px] text-[#b1b4a2] line-clamp-2 leading-relaxed">{item.desc}</p>
                    </button>
                  ))
                ) : (
                  <div className="p-4 text-center text-xs text-[#b1b4a2]/70 italic flex flex-col gap-1">
                    <span className="material-symbols-outlined text-base">sentiment_dissatisfied</span>
                    No documentation matched your query.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Mode Pill Toggle (Online vs Offline docs switcher) */}
          <div className="bg-[#1d1e18] border border-border-dark p-1 rounded-xl flex items-center justify-between gap-1 relative z-10 shrink-0">
            <button
              onClick={() => handleModeSwitch('offline')}
              className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] font-mono flex items-center justify-center gap-1.5 transition-all ${
                currentMode === 'offline'
                  ? 'bg-[#292a21] text-amber-400 border border-amber-500/20 shadow-sm'
                  : 'text-[#b1b4a2] hover:text-white'
              }`}
            >
              <span className={`size-1.5 rounded-full ${currentMode === 'offline' ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]' : 'bg-[#b1b4a2]/40'}`} />
              Not Initialized
            </button>
            <button
              onClick={() => handleModeSwitch('online')}
              className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] font-mono flex items-center justify-center gap-1.5 transition-all ${
                currentMode === 'online'
                  ? 'bg-[#292a21] text-primary border border-primary/20 shadow-sm'
                  : 'text-[#b1b4a2] hover:text-white'
              }`}
            >
              <span className={`size-1.5 rounded-full ${currentMode === 'online' ? 'bg-primary animate-pulse shadow-[0_0_8px_rgba(215,225,157,0.5)]' : 'bg-[#b1b4a2]/40'}`} />
              Initialized
            </button>
          </div>

          {/* Sidebar Navigation Links (TOC of current file) */}
          <nav className="flex-1 overflow-y-auto pr-1 space-y-1 scrollbar-thin select-none">
            <div className="text-[10px] font-mono text-[#b1b4a2]/40 uppercase tracking-widest px-2 mb-2 font-bold">
              {currentMode === 'offline' ? 'Agents Not Initialized' : 'Agents Initialized'}
            </div>
            <div className="space-y-0.5">
              {filteredHeadings.map((heading) => {
                const isActive = activeSection === heading.id
                const text = heading.text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
                const padding = heading.level === 3 ? 'pl-6' : 'pl-3'
                const border = isActive
                  ? 'border-l-2 border-primary text-primary bg-primary/5 font-semibold'
                  : 'border-l border-white/5 text-[#b1b4a2] hover:text-white hover:bg-white/2 hover:border-white/20'

                return (
                  <a
                    key={heading.id}
                    href={`#${heading.id}`}
                    onClick={() => setIsMobileOpen(false)}
                    className={`block py-1.5 pr-3 text-[12px] tracking-tight transition-all truncate leading-tight ${padding} ${border}`}
                  >
                    {text}
                  </a>
                )
              })}
            </div>
          </nav>
        </div>

        {/* Sidebar footer back actions */}
        <div className="mt-4 pt-4 border-t border-white/5 flex flex-col gap-2 shrink-0">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-xs text-[#b1b4a2] hover:text-white px-2 py-1.5 rounded-lg hover:bg-white/2 transition-colors font-light"
          >
            <span className="material-symbols-outlined text-sm">dashboard</span>
            Back to Dashboard
          </Link>
          <Link
            href="/"
            className="flex items-center gap-2 text-xs text-[#b1b4a2] hover:text-white px-2 py-1.5 rounded-lg hover:bg-white/2 transition-colors font-light"
          >
            <span className="material-symbols-outlined text-sm">home</span>
            Home Page
          </Link>
        </div>
      </aside>

      {/* Click-away backdrop overlay for Mobile Drawer */}
      {isMobileOpen && (
        <div
          onClick={() => setIsMobileOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden animate-fade-in"
        />
      )}
    </>
  )
}

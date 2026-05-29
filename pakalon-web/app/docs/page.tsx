'use client'

import React from 'react'
import Link from 'next/link'

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-background-dark text-white flex flex-col justify-between relative overflow-hidden font-sans">
      {/* Decorative background gradients */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-20">
        <div className="absolute -top-[10%] -left-[10%] w-[50%] h-[50%] bg-[#d7e19d]/20 rounded-full blur-[140px]"></div>
        <div className="absolute -bottom-[10%] -right-[10%] w-[50%] h-[50%] bg-[#d7e19d]/10 rounded-full blur-[140px]"></div>
      </div>

      {/* Main Header / Top Navigation */}
      <header className="z-10 w-full px-6 py-6 border-b border-border-dark/40 bg-[#161712]/50 backdrop-blur-md flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="size-9 rounded-xl bg-primary flex items-center justify-center transition-transform group-hover:scale-105">
            <span className="material-symbols-outlined text-[#161712] font-bold text-lg">menu_book</span>
          </div>
          <div>
            <span className="font-bold text-white text-[15px] tracking-tight group-hover:text-primary transition-colors">Pakalon Docs</span>
            <p className="text-[9px] font-mono text-primary/80 tracking-wide leading-none mt-0.5 uppercase">Reference Portal</p>
          </div>
        </Link>
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard"
            className="text-xs text-[#b1b4a2] hover:text-white transition-colors flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-dark bg-[#1d1e18] hover:bg-[#25261e]"
          >
            <span className="material-symbols-outlined text-sm">dashboard</span>
            Dashboard
          </Link>
        </div>
      </header>

      {/* Content Area */}
      <main className="z-10 flex-1 max-w-6xl w-full mx-auto px-6 py-12 md:py-20 flex flex-col justify-center gap-12">
        <div className="text-center space-y-4 max-w-2xl mx-auto">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-mono uppercase bg-primary/10 border border-primary/20 text-primary tracking-wider font-semibold">
            Documentation Portal
          </span>
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-white leading-tight">
            Select Reference Manual
          </h1>
          <p className="text-[#b1b4a2] text-sm md:text-base font-light leading-relaxed max-w-xl mx-auto">
            Choose a guide based on whether your workspace is running in offline mode or has initialized agentic capabilities.
          </p>
        </div>

        {/* Split Grid Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-10">
          
          {/* Card 1: Not Initialized (Core CLI) */}
          <div className="relative group rounded-2xl border border-border-dark bg-[#1d1e18]/60 hover:bg-[#25261e]/80 transition-all duration-300 p-8 flex flex-col justify-between shadow-[0_4px_20px_rgba(0,0,0,0.4)] hover:shadow-[0_4px_30px_rgba(215,225,157,0.05)] hover:-translate-y-1">
            <div className="absolute top-4 right-4 flex items-center gap-1">
              <span className="size-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
              <span className="text-[9px] font-mono text-amber-500 uppercase tracking-widest font-semibold">Not Initialized</span>
            </div>
            
            <div className="space-y-6">
              <div className="size-14 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                <span className="material-symbols-outlined text-3xl">cloud_off</span>
              </div>
              
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-white tracking-tight">Pakalon Agents (Not Initialized)</h2>
                <p className="text-[#b1b4a2] text-xs font-light leading-relaxed">
                  Documentation of Pakalon CLI behavior in local, offline mode. Perfect for developers managing local codebases using standard console integrations, manual commands, and offline models.
                </p>
              </div>

              {/* Bullet Highlights */}
              <ul className="space-y-2.5 text-xs text-[#c4c7b8] border-t border-border-dark/40 pt-5">
                <li className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-amber-400 text-sm">check_circle</span>
                  <span>Console interface & interactive REPL navigation</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-amber-400 text-sm">check_circle</span>
                  <span>Local models integration (Ollama & LM Studio)</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-amber-400 text-sm">check_circle</span>
                  <span>Slash commands reference & editor shortcuts</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-amber-400 text-sm">check_circle</span>
                  <span>15+ SAST/DAST local vulnerability scanners</span>
                </li>
              </ul>
            </div>

            <div className="mt-8 pt-4">
              <Link
                href="/docs/not-initialized"
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-amber-500/10 hover:bg-amber-500 text-amber-400 hover:text-[#161712] border border-amber-500/20 font-bold transition-all text-xs tracking-wider uppercase group-hover:scale-[1.01]"
              >
                Not Initialized Manual
                <span className="material-symbols-outlined text-sm font-bold">arrow_forward</span>
              </Link>
            </div>
          </div>

          {/* Card 2: Initialized (Agent Framework) */}
          <div className="relative group rounded-2xl border border-border-dark bg-[#1d1e18]/60 hover:bg-[#25261e]/80 transition-all duration-300 p-8 flex flex-col justify-between shadow-[0_4px_20px_rgba(0,0,0,0.4)] hover:shadow-[0_4px_30px_rgba(215,225,157,0.08)] hover:-translate-y-1">
            <div className="absolute top-4 right-4 flex items-center gap-1">
              <span className="size-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(215,225,157,0.5)]" />
              <span className="text-[9px] font-mono text-primary uppercase tracking-widest font-semibold">Initialized</span>
            </div>

            <div className="space-y-6">
              <div className="size-14 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined text-3xl">smart_toy</span>
              </div>

              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-white tracking-tight">Pakalon Agents (Initialized)</h2>
                <p className="text-[#b1b4a2] text-xs font-light leading-relaxed">
                  Manual for the autonomous multi-agent software engineering framework. Built for orchestrating swarms, configuring effort permissions, and utilizing isolated sandboxed runtimes.
                </p>
              </div>

              {/* Bullet Highlights */}
              <ul className="space-y-2.5 text-xs text-[#c4c7b8] border-t border-border-dark/40 pt-5">
                <li className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-sm">check_circle</span>
                  <span>Swarm orchestration hierarchy & specialist agents</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-sm">check_circle</span>
                  <span>Git Worktree file sandbox isolation & remote workspace</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-sm">check_circle</span>
                  <span>Mem0 SQLite persistent long-term learning database</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-sm">check_circle</span>
                  <span>6-Phase self-healing build pipeline execution</span>
                </li>
              </ul>
            </div>

            <div className="mt-8 pt-4">
              <Link
                href="/docs/initialized"
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-primary/10 hover:bg-primary text-primary hover:text-background-dark border border-primary/20 font-bold transition-all text-xs tracking-wider uppercase group-hover:scale-[1.01]"
              >
                Initialized Manual
                <span className="material-symbols-outlined text-sm font-bold">arrow_forward</span>
              </Link>
            </div>
          </div>

        </div>
      </main>

      {/* Footer bar */}
      <footer className="z-10 w-full px-6 py-5 border-t border-border-dark/40 bg-[#161712]/30 flex flex-col md:flex-row items-center justify-between text-xs text-[#b1b4a2]/70 font-light gap-2 mt-8">
        <div>&copy; {new Date().getFullYear()} Pakalon. All rights reserved.</div>
        <div className="flex gap-4">
          <Link href="/" className="hover:text-white transition-colors">Home</Link>
          <span className="text-[#b1b4a2]/20">|</span>
          <Link href="/dashboard" className="hover:text-white transition-colors">Dashboard</Link>
          <span className="text-[#b1b4a2]/20">|</span>
          <a href="https://github.com/Tarun-1516/Pakalon.git" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">GitHub Repository</a>
        </div>
      </footer>
    </div>
  )
}

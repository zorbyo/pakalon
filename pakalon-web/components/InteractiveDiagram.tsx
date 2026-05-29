'use client'

import React, { useState } from 'react'

interface InteractiveDiagramProps {
  type: 'core-arch' | 'agent-arch' | 'pipeline' | 'security-loop'
}

export default function InteractiveDiagram({ type }: InteractiveDiagramProps) {
  const [activeNode, setActiveNode] = useState<string | null>(null)

  if (type === 'core-arch') {
    const nodes = [
      {
        id: 'web',
        name: 'pakalon-web',
        tech: 'Next.js 16 · Tailwind · Supabase',
        desc: 'Web dashboard, marketing pages, billing portal (Polar), and user profile configuration.',
        color: 'border-primary/50 text-primary bg-primary/5 shadow-[0_0_15px_rgba(215,225,157,0.1)]',
      },
      {
        id: 'backend',
        name: 'pakalon-backend',
        tech: 'FastAPI · PostgreSQL · Redis',
        desc: 'Authentication validation, telemetry endpoints, usage tracking, OpenRouter LLM proxying, and webhook handling.',
        color: 'border-yellow-500/50 text-yellow-400 bg-yellow-500/5 shadow-[0_0_15px_rgba(234,179,8,0.1)]',
      },
      {
        id: 'cli',
        name: 'pakalon-cli',
        tech: 'TypeScript · Bun · Ink TUI',
        desc: 'Terminal TUI interface. Streams LLM chat, manages sessions, and initiates local workspace agent operations.',
        color: 'border-blue-500/50 text-blue-400 bg-blue-500/5 shadow-[0_0_15px_rgba(59,130,246,0.1)]',
      },
      {
        id: 'bridge',
        name: 'Python Bridge (Local)',
        tech: 'LangGraph · Mem0 · ChromaDB',
        desc: 'Local agent execution engine. Spawns specialized subagents, interacts with the local filesystem, and hooks into LSP.',
        color: 'border-purple-500/50 text-purple-400 bg-purple-500/5 shadow-[0_0_15px_rgba(168,85,247,0.1)]',
      },
      {
        id: 'penpot',
        name: 'Penpot Design',
        tech: 'Docker Container · port 3449',
        desc: 'Open-source design tool integrated into Phase 2 of the build pipeline for UI wireframing and SVG synchronization.',
        color: 'border-pink-500/50 text-pink-400 bg-pink-500/5 shadow-[0_0_15px_rgba(236,72,153,0.1)]',
      },
    ]

    return (
      <div className="border border-border-dark bg-surface-dark/40 rounded-2xl p-6 my-8 overflow-hidden relative backdrop-blur-sm">
        <div className="absolute top-3 right-4 flex items-center gap-1.5">
          <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
          <span className="text-[10px] font-mono text-primary uppercase tracking-wider">Interactive Architecture Flow</span>
        </div>
        <h4 className="text-white text-sm font-semibold mb-6 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-lg font-bold">account_tree</span>
          Core System Topology
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 relative z-10">
          {nodes.map((node) => (
            <div
              key={node.id}
              className={`p-4 rounded-xl border flex flex-col justify-between cursor-pointer transition-all duration-300 transform hover:-translate-y-1 ${
                activeNode === node.id ? 'ring-2 ring-primary/80 scale-[1.02]' : 'opacity-85 hover:opacity-100'
              } ${node.color}`}
              onClick={() => setActiveNode(activeNode === node.id ? null : node.id)}
            >
              <div>
                <div className="font-mono text-xs opacity-60 uppercase tracking-widest mb-1">{node.id}</div>
                <div className="font-bold text-sm tracking-tight mb-2">{node.name}</div>
              </div>
              <div className="text-[10px] font-mono opacity-80 border-t border-white/5 pt-2 mt-2">{node.tech}</div>
            </div>
          ))}
        </div>

        {/* Node detail display */}
        <div className="mt-6 p-4 rounded-xl border border-white/5 bg-black/40 min-h-[72px] flex items-center transition-all duration-300">
          {activeNode ? (
            <div className="space-y-1 w-full animate-fadeIn">
              <h5 className="font-bold text-xs text-primary font-mono uppercase">
                {nodes.find((n) => n.id === activeNode)?.name} Overview:
              </h5>
              <p className="text-xs text-[#b1b4a2] leading-relaxed">
                {nodes.find((n) => n.id === activeNode)?.desc}
              </p>
            </div>
          ) : (
            <p className="text-xs text-[#b1b4a2]/70 italic flex items-center gap-2 mx-auto">
              <span className="material-symbols-outlined text-sm">info</span>
              Click any architecture node above to explore its core responsibilities and technical details.
            </p>
          )}
        </div>
      </div>
    )
  }

  if (type === 'agent-arch') {
    const components = [
      {
        id: 'orchestrator',
        name: 'Orchestrator',
        desc: 'Central agent control plane. Coordinates parallel execution, aggregates logs, and manages token usage metrics.',
        icon: 'hub',
      },
      {
        id: 'main',
        name: 'Main Agent (TUI)',
        desc: 'User interaction portal in terminal. Handles chat streams, toggles plan/edit modes, and triggers build tasks.',
        icon: 'terminal',
      },
      {
        id: 'sub',
        name: 'Sub-agents (1-5)',
        desc: 'Specialist processes spawned by the orchestrator for isolated modular tasks (Layout, Styling, Backend, CI/CD).',
        icon: 'smart_toy',
      },
      {
        id: 'tools',
        name: 'Agent Tool Layer',
        desc: 'Standard interfaces providing filesystem actions, network fetching, LSP querying, and workspace configuration.',
        icon: 'construction',
      },
      {
        id: 'lsp',
        name: 'LSP Manager',
        desc: 'Launches local LSP servers (TypeScript, Pyright, Rust Analyzer) to perform definitions, hover types, and syntax safety checks.',
        icon: 'code_blocks',
      },
      {
        id: 'mcp',
        name: 'MCP Manager',
        desc: 'Exposes external APIs, DB credentials, and external prompt libraries to agents via Model Context Protocol standard.',
        icon: 'cloud_sync',
      },
    ]

    return (
      <div className="border border-border-dark bg-surface-dark/40 rounded-2xl p-6 my-8 relative overflow-hidden backdrop-blur-sm">
        <h4 className="text-white text-sm font-semibold mb-6 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-lg font-bold">insights</span>
          Multi-Agent Framework Hierarchy
        </h4>

        {/* Tree hierarchy graph */}
        <div className="flex flex-col items-center gap-6 z-10 relative">
          {/* Level 1: Orchestrator */}
          <div
            className={`w-52 p-3 rounded-xl border border-primary/40 bg-primary/5 text-primary text-center cursor-pointer transition-all duration-300 hover:scale-105 ${
              activeNode === 'orchestrator' ? 'ring-2 ring-primary' : ''
            }`}
            onClick={() => setActiveNode('orchestrator')}
          >
            <span className="material-symbols-outlined text-xl mb-1">hub</span>
            <div className="font-bold text-xs">Orchestrator</div>
            <div className="text-[9px] font-mono opacity-60">Central Coordinator</div>
          </div>

          {/* Connective Line */}
          <div className="w-0.5 h-4 bg-border-dark" />

          {/* Level 2: Main Agent and Sub-Agents */}
          <div className="flex items-center gap-12">
            <div
              className={`w-44 p-3 rounded-xl border border-blue-500/40 bg-blue-500/5 text-blue-400 text-center cursor-pointer transition-all duration-300 hover:scale-105 ${
                activeNode === 'main' ? 'ring-2 ring-blue-500' : ''
              }`}
              onClick={() => setActiveNode('main')}
            >
              <span className="material-symbols-outlined text-xl mb-1">terminal</span>
              <div className="font-bold text-xs">Main Agent</div>
              <div className="text-[9px] font-mono opacity-60">Interactive TUI</div>
            </div>

            <div
              className={`w-44 p-3 rounded-xl border border-purple-500/40 bg-purple-500/5 text-purple-400 text-center cursor-pointer transition-all duration-300 hover:scale-105 ${
                activeNode === 'sub' ? 'ring-2 ring-purple-500' : ''
              }`}
              onClick={() => setActiveNode('sub')}
            >
              <span className="material-symbols-outlined text-xl mb-1">smart_toy</span>
              <div className="font-bold text-xs">Sub-agents (1-5)</div>
              <div className="text-[9px] font-mono opacity-60">Isolated Specialists</div>
            </div>
          </div>

          {/* Connective Line */}
          <div className="w-0.5 h-4 bg-border-dark" />

          {/* Level 3: Tools Layer */}
          <div
            className={`w-64 p-3 rounded-xl border border-yellow-500/40 bg-yellow-500/5 text-yellow-400 text-center cursor-pointer transition-all duration-300 hover:scale-105 ${
              activeNode === 'tools' ? 'ring-2 ring-yellow-500' : ''
            }`}
            onClick={() => setActiveNode('tools')}
          >
            <span className="material-symbols-outlined text-xl mb-1">construction</span>
            <div className="font-bold text-xs">Agent Tool Layer</div>
            <div className="text-[9px] font-mono opacity-60">File, Bash, Search, LSP, MCP Interfaces</div>
          </div>

          {/* Connective Line */}
          <div className="w-0.5 h-4 bg-border-dark" />

          {/* Level 4: Managers */}
          <div className="flex items-center gap-12">
            <div
              className={`w-44 p-3 rounded-xl border border-cyan-500/40 bg-cyan-500/5 text-cyan-400 text-center cursor-pointer transition-all duration-300 hover:scale-105 ${
                activeNode === 'lsp' ? 'ring-2 ring-cyan-500' : ''
              }`}
              onClick={() => setActiveNode('lsp')}
            >
              <span className="material-symbols-outlined text-xl mb-1">code_blocks</span>
              <div className="font-bold text-xs">LSP Server Manager</div>
              <div className="text-[9px] font-mono opacity-60">Static Code Safety</div>
            </div>

            <div
              className={`w-44 p-3 rounded-xl border border-pink-500/40 bg-pink-500/5 text-pink-400 text-center cursor-pointer transition-all duration-300 hover:scale-105 ${
                activeNode === 'mcp' ? 'ring-2 ring-pink-500' : ''
              }`}
              onClick={() => setActiveNode('mcp')}
            >
              <span className="material-symbols-outlined text-xl mb-1">cloud_sync</span>
              <div className="font-bold text-xs">MCP Manager</div>
              <div className="text-[9px] font-mono opacity-60">External Integrations</div>
            </div>
          </div>
        </div>

        {/* Info panel */}
        <div className="mt-6 p-4 rounded-xl border border-white/5 bg-black/40 min-h-[72px] flex items-center transition-all duration-300">
          {activeNode ? (
            <div className="space-y-1 w-full animate-fadeIn">
              <h5 className="font-bold text-xs text-primary font-mono uppercase">
                {components.find((c) => c.id === activeNode)?.name} Component:
              </h5>
              <p className="text-xs text-[#b1b4a2] leading-relaxed">
                {components.find((c) => c.id === activeNode)?.desc}
              </p>
            </div>
          ) : (
            <p className="text-xs text-[#b1b4a2]/70 italic flex items-center gap-2 mx-auto">
              <span className="material-symbols-outlined text-sm">info</span>
              Click any tier in the diagram structure to inspect component responsibilities.
            </p>
          )}
        </div>
      </div>
    )
  }

  if (type === 'pipeline') {
    const phases = [
      {
        num: '1',
        title: 'Planning',
        task: 'Research codebase & generate prompt questions.',
        detail: 'Builds spec files (.pakalon/spec.md), context boundaries, and dev instructions (CLAUDE.md) in non-interactive/HIL mode.',
        icon: 'map',
      },
      {
        num: '2',
        title: 'Wireframes',
        task: 'Generate and export UI layouts via Penpot API.',
        detail: 'Renders mockup SVG shapes inside local Docker containers, watches for edits, and translates layouts to layout manifests.',
        icon: 'palette',
      },
      {
        num: '3',
        title: 'Frontend',
        task: 'Scaffold layout nodes and custom React components.',
        detail: 'Spawns 5 parallel subagents specializing in Layout, UI, States, API logic, and Styling templates using Tailwind.',
        icon: 'desktop_windows',
      },
      {
        num: '4',
        title: 'Security QA',
        task: 'Automated vulnerability scanning suite.',
        detail: 'Applies 15+ SAST/DAST tools (Semgrep, Gitleaks, ZAP, Nikto) to scan files and network headers, returning code feedback.',
        icon: 'security',
      },
      {
        num: '5',
        title: 'CI/CD',
        task: 'Build Docker packages and open GitHub PR.',
        detail: 'Drafts workflows (.github/workflows/ci.yml) and creates standard Git branch worktrees to push codebase adjustments.',
        icon: 'rocket_launch',
      },
      {
        num: '6',
        title: 'Documentation',
        task: 'Generate project README and API endpoints.',
        detail: 'Compiles technical route specs, usage guidelines, CHANGELOG summaries, and developer contribution guides.',
        icon: 'menu_book',
      },
    ]

    return (
      <div className="border border-border-dark bg-surface-dark/40 rounded-2xl p-6 my-8 relative overflow-hidden backdrop-blur-sm">
        <h4 className="text-white text-sm font-semibold mb-6 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-lg font-bold">cached</span>
          6-Phase Build Pipeline
        </h4>

        {/* Responsive grid displaying steps */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 z-10 relative">
          {phases.map((phase) => (
            <div
              key={phase.num}
              className={`p-4 rounded-xl border cursor-pointer transition-all duration-300 flex flex-col justify-between h-40 ${
                activeNode === phase.num
                  ? 'border-primary bg-primary/10 scale-[1.02] shadow-[0_0_12px_rgba(215,225,157,0.15)]'
                  : 'border-white/5 bg-black/20 hover:border-white/20 hover:bg-black/30'
              }`}
              onClick={() => setActiveNode(activeNode === phase.num ? null : phase.num)}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center justify-center size-6 rounded-full bg-primary/20 text-primary text-xs font-bold font-mono">
                  {phase.num}
                </span>
                <span className="material-symbols-outlined text-sm opacity-60">{phase.icon}</span>
              </div>
              <div>
                <h5 className="font-bold text-xs text-white mb-1">{phase.title}</h5>
                <p className="text-[10px] text-[#b1b4a2] line-clamp-3 leading-snug">{phase.task}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Explain details */}
        <div className="mt-4 p-4 rounded-xl border border-white/5 bg-black/40 min-h-[72px] flex items-center transition-all duration-300">
          {activeNode ? (
            <div className="space-y-1 w-full animate-fadeIn">
              <h5 className="font-bold text-xs text-primary font-mono uppercase">
                Phase {activeNode} Detail ({phases.find((p) => p.num === activeNode)?.title}):
              </h5>
              <p className="text-xs text-[#b1b4a2] leading-relaxed">
                {phases.find((p) => p.num === activeNode)?.detail}
              </p>
            </div>
          ) : (
            <p className="text-xs text-[#b1b4a2]/70 italic flex items-center gap-2 mx-auto">
              <span className="material-symbols-outlined text-sm">info</span>
              Click any phase step in the pipeline track above to see its technical operation and outputs.
            </p>
          )}
        </div>
      </div>
    )
  }

  if (type === 'security-loop') {
    const loopSteps = [
      { id: '1', title: 'Phase 3 (Frontend/Backend)', desc: 'Specialist subagents generate structural files, schemas, and endpoints.' },
      { id: '2', title: 'Phase 4 (Security QA)', desc: 'Docker scan suite runs SAST code analysis and live DAST vulnerability checks.' },
      { id: '3', title: 'Vulnerabilities Discovered', desc: 'Gitleaks, Semgrep, or Nikto flag security errors with details and severity.' },
      { id: '4', title: 'Automated Feedback', desc: 'Core agent captures log exceptions and compiles code fix objectives.' },
      { id: '5', title: 'Agent Code Refactor', desc: 'Codebase files are corrected to mitigate security risks.' },
      { id: '6', title: 'Re-scan verification', desc: 'Scans run again to confirm vulnerabilities are resolved before CI/CD.' },
    ]

    return (
      <div className="border border-border-dark bg-surface-dark/40 rounded-2xl p-6 my-8 relative overflow-hidden backdrop-blur-sm">
        <h4 className="text-white text-sm font-semibold mb-6 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-lg font-bold">published_with_changes</span>
          Security QA Feedback Loop
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 relative z-10 mb-4">
          {loopSteps.map((step) => (
            <div
              key={step.id}
              className={`p-3.5 rounded-xl border cursor-pointer transition-all duration-300 flex flex-col justify-between min-h-[110px] ${
                activeNode === step.id
                  ? 'border-red-500/50 bg-red-500/5 shadow-[0_0_10px_rgba(239,68,68,0.1)] scale-[1.02]'
                  : 'border-white/5 bg-black/20 hover:border-white/10'
              }`}
              onClick={() => setActiveNode(activeNode === step.id ? null : step.id)}
            >
              <div className="font-mono text-[9px] text-[#b1b4a2]/60 uppercase">Step {step.id}</div>
              <div className="font-bold text-xs text-white my-1">{step.title}</div>
              <div className="text-[9px] text-red-400 font-mono flex items-center gap-1 mt-1">
                <span className="material-symbols-outlined text-xs">arrow_forward</span>
                Info
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 rounded-xl border border-white/5 bg-black/40 min-h-[72px] flex items-center transition-all duration-300">
          {activeNode ? (
            <div className="space-y-1 w-full animate-fadeIn">
              <h5 className="font-bold text-xs text-red-400 font-mono uppercase">
                Step {activeNode} Explanation ({loopSteps.find((s) => s.id === activeNode)?.title}):
              </h5>
              <p className="text-xs text-[#b1b4a2] leading-relaxed">
                {loopSteps.find((s) => s.id === activeNode)?.desc}
              </p>
            </div>
          ) : (
            <p className="text-xs text-[#b1b4a2]/70 italic flex items-center gap-2 mx-auto">
              <span className="material-symbols-outlined text-sm">info</span>
              Click any loop step in the feedback diagram above to inspect how security vulnerabilities are automatically fixed.
            </p>
          )}
        </div>
      </div>
    )
  }

  return null
}

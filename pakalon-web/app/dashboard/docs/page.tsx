'use client'

import { useState } from 'react'

export default function DocsPage() {
    const [section, setSection] = useState<'initialized' | 'not-initialized'>('initialized')

    return (
        <div className="flex h-full">
            {/* Sidebar */}
            <aside className="w-72 flex-shrink-0 border-r border-border-dark bg-[#161712] p-6 overflow-y-auto hidden xl:block">
                <div className="space-y-8">
                    <div>
                        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4">
                            Getting Started
                        </h3>
                        <ul className="space-y-2">
                            <li>
                                <a href="#" className="text-sm text-[#b1b4a2] hover:text-white flex items-center gap-3">
                                    <span className="material-symbols-outlined text-lg text-primary">rocket_launch</span>
                                    Introduction
                                </a>
                            </li>
                            <li>
                                <a href="#" className="text-sm text-[#b1b4a2] hover:text-white flex items-center gap-3">
                                    <span className="material-symbols-outlined text-lg">install_desktop</span>
                                    Installation
                                </a>
                            </li>
                        </ul>
                    </div>
                    <div>
                        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4">
                            Configuration
                        </h3>
                        <ul className="space-y-2">
                            <li>
                                <a href="#" className="text-sm text-[#b1b4a2] hover:text-white flex items-center gap-3">
                                    <span className="material-symbols-outlined text-lg">settings</span>
                                    General
                                </a>
                            </li>
                            <li>
                                <button
                                    onClick={() => setSection('initialized')}
                                    className={`w-full text-left text-sm flex items-center gap-3 ${section === 'initialized' ? 'text-primary font-medium' : 'text-[#b1b4a2] hover:text-white'}`}
                                >
                                    <span className="material-symbols-outlined text-lg">smart_toy</span>
                                    Agents — Initialized
                                </button>
                            </li>
                            <li>
                                <button
                                    onClick={() => setSection('not-initialized')}
                                    className={`w-full text-left text-sm flex items-center gap-3 ${section === 'not-initialized' ? 'text-primary font-medium' : 'text-[#b1b4a2] hover:text-white'}`}
                                >
                                    <span className="material-symbols-outlined text-lg">smart_toy</span>
                                    Agents — Not Initialized
                                </button>
                            </li>
                            <li>
                                <a href="#" className="text-sm text-[#b1b4a2] hover:text-white flex items-center gap-3">
                                    <span className="material-symbols-outlined text-lg">security</span>
                                    Authentication
                                </a>
                            </li>
                        </ul>
                    </div>
                </div>
            </aside>

            <div className="flex-1 p-8 lg:p-12 overflow-y-auto">
                <div className="max-w-3xl space-y-12">

                    {/* Header */}
                    <header className="space-y-4 border-b border-border-dark pb-8">
                        <nav className="flex items-center gap-2 text-xs font-mono text-[#b1b4a2]">
                            <span>Docs</span>{' '}
                            <span className="material-symbols-outlined text-sm">chevron_right</span>
                            <span>Configuration</span>{' '}
                            <span className="material-symbols-outlined text-sm">chevron_right</span>
                            <span className="text-white">Agents Configuration</span>
                        </nav>
                        <h1 className="text-4xl font-bold tracking-tight text-white">Agents Configuration</h1>
                        <p className="text-lg text-[#b1b4a2] font-light leading-relaxed">
                            Manage your AI CLI tool bridge settings. Configure how local agents interact with the
                            Pakalon cloud infrastructure.
                        </p>

                        {/* Tab switcher */}
                        <div className="flex gap-2 pt-2">
                            <button
                                onClick={() => setSection('initialized')}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${section === 'initialized'
                                        ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                                        : 'bg-surface-dark border border-border-dark text-[#b1b4a2] hover:text-white'
                                    }`}
                            >
                                <span className="material-symbols-outlined text-base">
                                    {section === 'initialized' ? 'check_circle' : 'radio_button_unchecked'}
                                </span>
                                Agents Initialized
                            </button>
                            <button
                                onClick={() => setSection('not-initialized')}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${section === 'not-initialized'
                                        ? 'bg-red-500/10 border border-red-500/30 text-red-400'
                                        : 'bg-surface-dark border border-border-dark text-[#b1b4a2] hover:text-white'
                                    }`}
                            >
                                <span className="material-symbols-outlined text-base">
                                    {section === 'not-initialized' ? 'cancel' : 'radio_button_unchecked'}
                                </span>
                                Agents Not Initialized
                            </button>
                        </div>
                    </header>

                    {/* ── Section A: Initialized ── */}
                    {section === 'initialized' && (
                        <>
                            <section className="space-y-6">
                                <div className="flex items-center gap-3">
                                    <div className="size-8 rounded-lg bg-green-500/10 flex items-center justify-center text-green-400 border border-green-500/20">
                                        <span className="material-symbols-outlined text-[20px]">check_circle</span>
                                    </div>
                                    <h2 className="text-2xl font-bold text-white">Pakalon-Agents Initialized</h2>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    <div className="space-y-4">
                                        <p className="text-[#b1b4a2] leading-relaxed text-sm">
                                            When agents are successfully initialized, the CLI bridge establishes a secure
                                            websocket connection to the Pakalon usage tracking service.
                                        </p>
                                        <div className="bg-surface-dark border border-border-dark rounded-lg p-4 space-y-3">
                                            <h4 className="text-white text-sm font-medium flex items-center gap-2">
                                                <span className="material-symbols-outlined text-sm text-primary">info</span>
                                                Key Capabilities
                                            </h4>
                                            <ul className="space-y-2 text-xs text-[#b1b4a2]">
                                                <li className="flex gap-2"><span>-></span> Automated error reporting</li>
                                                <li className="flex gap-2"><span>-></span> Live context injection</li>
                                                <li className="flex gap-2"><span>-></span> Persistent session history</li>
                                            </ul>
                                        </div>
                                    </div>

                                    <div className="bg-surface-dark border border-border-dark rounded-xl p-6 flex items-center justify-center relative overflow-hidden">
                                        <div className="flex flex-col items-center gap-4 z-10">
                                            <div className="flex items-center gap-8">
                                                <div className="size-12 rounded bg-background-dark border border-border-dark flex items-center justify-center shadow-lg">
                                                    <span className="material-symbols-outlined">terminal</span>
                                                </div>
                                                <div className="flex-1 h-px w-20 bg-primary/30 relative">
                                                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface-dark px-1 text-[8px] font-mono text-primary">
                                                        WSS://
                                                    </div>
                                                </div>
                                                <div className="size-12 rounded bg-background-dark border border-primary flex items-center justify-center shadow-lg">
                                                    <span className="material-symbols-outlined text-primary">cloud_done</span>
                                                </div>
                                            </div>
                                            <span className="text-[10px] text-[#b1b4a2] font-mono uppercase">
                                                Active Bidirectional Stream
                                            </span>
                                        </div>
                                        <div className="absolute inset-0 bg-primary/5 opacity-20 pointer-events-none"></div>
                                    </div>
                                </div>
                            </section>

                            <section className="space-y-4">
                                <h3 className="text-lg font-medium text-white">Verification Command</h3>
                                <div className="rounded-lg border border-border-dark bg-black overflow-hidden">
                                    <div className="flex items-center justify-between px-4 py-2 bg-surface-dark border-b border-border-dark">
                                        <div className="flex gap-1.5">
                                            <div className="size-2 rounded-full bg-red-500/50"></div>
                                            <div className="size-2 rounded-full bg-yellow-500/50"></div>
                                            <div className="size-2 rounded-full bg-green-500/50"></div>
                                        </div>
                                        <span className="text-[10px] font-mono text-[#b1b4a2]">bash</span>
                                    </div>
                                    <div className="p-4 font-mono text-sm space-y-2">
                                        <p>
                                            <span className="text-primary">pakalon</span> status --verbose --json
                                        </p>
                                        <div className="text-[11px] text-[#b1b4a2] border-t border-white/5 pt-2 mt-2">
                                            <p className="text-green-400">-> Status: Online</p>
                                            <p>-> Bridge: v2.4.1 connected</p>
                                            <p>-> Latency: 42ms</p>
                                        </div>
                                    </div>
                                </div>
                            </section>
                        </>
                    )}

                    {/* ── Section B: Not Initialized ── */}
                    {section === 'not-initialized' && (
                        <>
                            <section className="space-y-6">
                                <div className="flex items-center gap-3">
                                    <div className="size-8 rounded-lg bg-red-500/10 flex items-center justify-center text-red-400 border border-red-500/20">
                                        <span className="material-symbols-outlined text-[20px]">cancel</span>
                                    </div>
                                    <h2 className="text-2xl font-bold text-white">Pakalon-Agents Not Initialized</h2>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    <div className="space-y-4">
                                        <p className="text-[#b1b4a2] leading-relaxed text-sm">
                                            When agents are not initialized, the CLI runs in offline mode. No telemetry
                                            is sent, and features that depend on the Pakalon cloud are unavailable until
                                            agents are started.
                                        </p>
                                        <div className="bg-surface-dark border border-red-500/20 rounded-lg p-4 space-y-3">
                                            <h4 className="text-red-400 text-sm font-medium flex items-center gap-2">
                                                <span className="material-symbols-outlined text-sm">warning</span>
                                                Limitations
                                            </h4>
                                            <ul className="space-y-2 text-xs text-[#b1b4a2]">
                                                <li className="flex gap-2"><span>[X]</span> No cloud context injection</li>
                                                <li className="flex gap-2"><span>[X]</span> No live usage tracking</li>
                                                <li className="flex gap-2"><span>[X]</span> No persistent session sync</li>
                                            </ul>
                                        </div>
                                    </div>

                                    <div className="bg-surface-dark border border-border-dark rounded-xl p-6 flex items-center justify-center relative overflow-hidden">
                                        <div className="flex flex-col items-center gap-4 z-10">
                                            <div className="flex items-center gap-8">
                                                <div className="size-12 rounded bg-background-dark border border-border-dark flex items-center justify-center shadow-lg">
                                                    <span className="material-symbols-outlined">terminal</span>
                                                </div>
                                                <div className="flex-1 h-px w-20 bg-red-500/30 relative">
                                                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface-dark px-1 text-[8px] font-mono text-red-400">
                                                        OFFLINE
                                                    </div>
                                                </div>
                                                <div className="size-12 rounded bg-background-dark border border-red-500/40 flex items-center justify-center shadow-lg">
                                                    <span className="material-symbols-outlined text-red-400">cloud_off</span>
                                                </div>
                                            </div>
                                            <span className="text-[10px] text-[#b1b4a2] font-mono uppercase">
                                                No Active Connection
                                            </span>
                                        </div>
                                        <div className="absolute inset-0 bg-red-500/5 opacity-20 pointer-events-none"></div>
                                    </div>
                                </div>
                            </section>

                            <section className="space-y-4">
                                <h3 className="text-lg font-medium text-white">Initialize Agents</h3>
                                <p className="text-sm text-[#b1b4a2]">
                                    Run the following command to start Pakalon agents and connect to the cloud bridge:
                                </p>
                                <div className="rounded-lg border border-border-dark bg-black overflow-hidden">
                                    <div className="flex items-center justify-between px-4 py-2 bg-surface-dark border-b border-border-dark">
                                        <div className="flex gap-1.5">
                                            <div className="size-2 rounded-full bg-red-500/50"></div>
                                            <div className="size-2 rounded-full bg-yellow-500/50"></div>
                                            <div className="size-2 rounded-full bg-green-500/50"></div>
                                        </div>
                                        <span className="text-[10px] font-mono text-[#b1b4a2]">bash</span>
                                    </div>
                                    <div className="p-4 font-mono text-sm space-y-2">
                                        <p>
                                            <span className="text-primary">pakalon</span> agents init
                                        </p>
                                        <div className="text-[11px] text-[#b1b4a2] border-t border-white/5 pt-2 mt-2">
                                            <p className="text-yellow-400">-> No agents detected. Starting initialization...</p>
                                            <p>-> Connecting to Pakalon cloud...</p>
                                            <p className="text-green-400">-> Agents initialized successfully.</p>
                                        </div>
                                    </div>
                                </div>
                            </section>
                        </>
                    )}

                </div>
            </div>
        </div>
    )
}

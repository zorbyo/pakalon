'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

interface Change {
    type: 'added' | 'changed' | 'fixed'
    text: string
}

interface VersionEntry {
    version: string
    date: string
    label?: string
    summary: string
    changes: Change[]
}

const changelog: VersionEntry[] = [
    {
        version: '1.0.0',
        date: 'February 2026',
        label: 'Initial Release',
        summary: 'The first public release of Pakalon — an AI-powered, security-first CLI agent platform.',
        changes: [
            { type: 'added', text: 'Pakalon CLI with secure GitHub OAuth login' },
            { type: 'added', text: 'Support for 550+ AI models via a unified API' },
            { type: 'added', text: 'Built-in security scanning: Bandit, sqlmap, Semgrep, OWASP ZAP, Nikto, and more' },
            { type: 'added', text: 'Penpot integration for wireframing and design within the workflow' },
            { type: 'added', text: 'mem0 long-term memory support for persistent AI context' },
            { type: 'added', text: 'Pakalon-Agents: bidirectional WSS bridge between CLI and cloud' },
            { type: 'added', text: 'Dashboard with usage analytics, billing, and profile management' },
            { type: 'added', text: 'Free plan with 30-day trial and Pro plan with unlimited sessions' },
            { type: 'added', text: 'Interactive documentation page with initialized / not-initialized states' },
        ],
    },
]

const typeStyles: Record<Change['type'], { bg: string; text: string; label: string }> = {
    added: { bg: 'bg-green-500/10 border-green-500/20', text: 'text-green-400', label: 'Added' },
    changed: { bg: 'bg-primary/10  border-primary/20', text: 'text-primary', label: 'Changed' },
    fixed: { bg: 'bg-red-500/10  border-red-500/20', text: 'text-red-400', label: 'Fixed' },
}

function ChangelogContent() {
    const searchParams = useSearchParams()
    const from = searchParams.get('from')
    const backHref = from === 'dashboard' ? '/dashboard' : '/'
    const backLabel = from === 'dashboard' ? 'Back to Dashboard' : 'Back to Home'

    return (
        <div className="min-h-screen bg-[#0d0e0b] text-white flex flex-col">

            {/* ── Top Nav ── */}
            <nav className="sticky top-0 z-50 w-full border-b border-white/10 bg-[#0d0e0b]/90 backdrop-blur-md px-6 py-3">
                <div className="max-w-4xl mx-auto flex items-center justify-between">
                    {/* Back + Brand */}
                    <div className="flex items-center gap-4">
                        <Link
                            href={backHref}
                            className="inline-flex items-center gap-1.5 text-sm text-[#b1b4a2] hover:text-white transition-colors group"
                        >
                            <span className="material-symbols-outlined text-base group-hover:-translate-x-0.5 transition-transform">
                                arrow_back
                            </span>
                            {backLabel}
                        </Link>
                        <div className="w-px h-5 bg-white/10" />
                        <div className="flex items-center gap-2.5">
                            <span className="font-bold text-white text-base tracking-tight">Pakalon</span>
                            <span className="px-2 py-0.5 rounded-full bg-primary/20 border border-primary/30 text-primary text-[10px] font-bold tracking-wide">
                                Changelog
                            </span>
                        </div>
                    </div>

                    {/* Right links */}
                    <div className="flex items-center gap-5 text-sm text-[#b1b4a2]">
                        <Link href="/" className="hover:text-white transition-colors">Home</Link>
                        <Link href="/docs" className="hover:text-white transition-colors">Docs</Link>
                        <Link href="/pricing" className="hover:text-white transition-colors">Pricing</Link>
                    </div>
                </div>
            </nav>

            {/* ── Hero ── */}
            <header className="max-w-4xl mx-auto w-full px-6 pt-14 pb-10 border-b border-white/8 space-y-3">
                <nav className="flex items-center gap-1 text-xs text-[#b1b4a2]">
                    <span>Pakalon</span>
                    <span className="material-symbols-outlined text-sm">chevron_right</span>
                    <span className="text-white">Changelog</span>
                </nav>
                <h1 className="text-4xl font-bold tracking-tight text-white">Changelog</h1>
                <p className="text-[#b1b4a2] text-lg font-light leading-relaxed">
                    All notable changes to Pakalon are documented here, from the oldest to the latest release.
                </p>
            </header>

            {/* ── Timeline ── */}
            <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-12">
                <div className="relative">

                    {/* Vertical timeline line */}
                    <div className="absolute left-[7px] top-2 bottom-0 w-px bg-border-dark hidden sm:block" />

                    <div className="space-y-14">
                        {changelog.map((entry) => (
                            <div key={entry.version} className="relative flex gap-8">

                                {/* Timeline dot */}
                                <div className="relative hidden sm:flex flex-col items-center">
                                    <div className="size-4 rounded-full bg-primary border-2 border-[#0d0e0b] shadow-[0_0_0_4px_rgba(215,225,157,0.15)] mt-1 shrink-0" />
                                </div>

                                {/* Card */}
                                <div className="flex-1 bg-[#161712] border border-white/8 rounded-2xl p-7 space-y-6">

                                    {/* Version header */}
                                    <div className="flex flex-wrap items-center gap-3">
                                        <span className="text-2xl font-bold text-white font-mono">v{entry.version}</span>
                                        {entry.label && (
                                            <span className="px-2.5 py-0.5 rounded-full bg-primary/20 border border-primary/30 text-primary text-[10px] font-bold tracking-wide uppercase">
                                                {entry.label}
                                            </span>
                                        )}
                                        <span className="ml-auto text-xs text-[#b1b4a2] font-mono">{entry.date}</span>
                                    </div>

                                    {/* Summary */}
                                    <p className="text-[#b1b4a2] text-sm leading-relaxed border-l-2 border-primary/40 pl-4">
                                        {entry.summary}
                                    </p>

                                    <ul className="space-y-2.5">
                                        {entry.changes.map((change, i) => (
                                            <li key={i} className="flex items-start gap-2 text-sm text-[#b1b4a2]">
                                                <span className="mt-1.5 size-1.5 rounded-full bg-[#b1b4a2]/50 shrink-0" />
                                                {change.text}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* End of timeline — "more coming" hint */}
                    <div className="relative flex gap-8 mt-10">
                        <div className="hidden sm:flex flex-col items-center">
                            <div className="size-4 rounded-full bg-[#25261e] border border-border-dark mt-1 shrink-0 flex items-center justify-center">
                                <div className="size-1.5 rounded-full bg-[#b1b4a2]/40" />
                            </div>
                        </div>
                        <p className="flex-1 text-xs text-[#b1b4a2]/50 font-mono pt-1">
                            More updates coming soon…
                        </p>
                    </div>
                </div>
            </main>

            {/* ── Footer ── */}
            <footer className="border-t border-white/5 bg-[#0d0e0b] py-4">
                <p className="text-center text-xs text-[#b1b4a2]">© 2026 Pakalon Inc. All rights reserved.</p>
            </footer>
        </div>
    )
}

export default function ChangelogPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-[#0d0e0b]" />}>
            <ChangelogContent />
        </Suspense>
    )
}

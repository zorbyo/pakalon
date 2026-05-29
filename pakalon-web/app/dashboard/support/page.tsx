'use client'

import { useState } from 'react'
import { api, useUser } from '@/lib/api'

export default function SupportPage() {
    const { user } = useUser()
    const [subject, setSubject] = useState('')
    const [category, setCategory] = useState('General')
    const [message, setMessage] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!message.trim() || !subject.trim()) return
        setSubmitting(true)
        setResult(null)
        try {
            const res = await api.submitSupport({
                name: user?.display_name || user?.github_login || 'Pakalon User',
                email: user?.email || 'unknown@pakalon.dev',
                subject: `[${category}] ${subject}`,
                message,
            })
            setResult(res)
            if (res.success) {
                setSubject('')
                setCategory('General')
                setMessage('')
            }
        } catch (err) {
            setResult({ success: false, message: (err as Error).message || 'Failed to send message.' })
        } finally {
            setSubmitting(false)
        }
    }
    return (
        <div className="max-w-5xl mx-auto p-8 lg:p-12 space-y-8">
            <div className="space-y-2">
                <h1 className="text-4xl font-bold tracking-tight text-white">Contact &amp; Support</h1>
                <p className="text-[#b1b4a2] max-w-xl">
                    We&apos;re here to help with your CLI integration, authentication issues, or any other
                    questions.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                <div className="lg:col-span-4 flex flex-col gap-4">
                    {[
                        { label: 'Email Us', desc: 'support@pakalon.dev', icon: 'mail' },
                        { label: 'Documentation', desc: 'Explore the CLI docs', icon: 'menu_book' },
                        { label: 'Developed at', desc: 'Salem, Tamilnadu', icon: 'location_on' },
                    ].map((card, i) => (
                        <div
                            key={i}
                            className="flex items-start gap-4 p-5 rounded-2xl bg-surface-dark border border-border-dark group hover:border-primary/50 transition-all cursor-pointer"
                        >
                            <div className="bg-surface-dark/30 p-3 rounded-xl group-hover:bg-primary/20 transition-colors border border-border-dark">
                                <span className="material-symbols-outlined text-white group-hover:text-primary">
                                    {card.icon}
                                </span>
                            </div>
                            <div>
                                <h3 className="text-white font-bold mb-1">{card.label}</h3>
                                <p className="text-[#b1b4a2] text-sm group-hover:text-white">{card.desc}</p>
                            </div>
                        </div>
                    ))}

                    <div className="relative w-full h-[280px] rounded-2xl border border-border-dark overflow-hidden mt-2 bg-background-dark">
                        <div 
                            className="absolute inset-0"
                            style={{ 
                                backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.1) 1px, transparent 0)',
                                backgroundSize: '16px 16px'
                            }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center px-4 drop-shadow-2xl">
                            <div className="bg-[#1c1c1c] border border-white/5 rounded-xl p-4 w-full shadow-2xl flex items-center gap-3">
                                <div className="bg-[#064e3b] border border-[#047857] rounded-lg w-10 h-10 flex items-center justify-center flex-shrink-0">
                                    <span className="material-symbols-outlined text-[#34d399] text-xl">
                                        location_on
                                    </span>
                                </div>
                                
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-white font-bold text-[14px]">Developed at Salem</h4>
                                        <div className="w-[32px] h-[24px] rounded-[3px] flex items-center justify-center flex-shrink-0 ml-2 overflow-hidden border border-white/10">
                                            <img src="/others/LTTE.jpg" alt="Salem Logo" className="w-full h-full object-cover" />
                                        </div>
                                    </div>
                                    <p className="text-[#b1b4a2] text-[13px] mt-0.5 truncate">Salem, Tamil Nadu</p>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                        <p className="text-[#93c5fd] text-[13px] truncate">India</p>
                                        <span className="text-[#52525b] text-[10px]">*</span>
                                        <p className="text-[#b1b4a2] text-[13px] truncate">Built with care</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="lg:col-span-8">
                    <div className="bg-surface-dark border border-border-dark rounded-2xl p-8 space-y-8">
                        <div className="space-y-1">
                            <h2 className="text-2xl font-bold text-white">Send us a message</h2>
                            <p className="text-[#b1b4a2]">Got a bug report or feature request? We&apos;d love to hear from you.</p>
                        </div>

                        <form className="space-y-6" onSubmit={handleSubmit}>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-white">Subject</label>
                                    <input
                                        type="text"
                                        value={subject}
                                        onChange={(e) => setSubject(e.target.value)}
                                        placeholder="What is this regarding?"
                                        required
                                        className="w-full bg-background-dark/50 border border-border-dark rounded-xl px-4 py-3 text-white focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-white">Category</label>
                                    <select
                                        value={category}
                                        onChange={(e) => setCategory(e.target.value)}
                                        className="w-full bg-background-dark/50 border border-border-dark rounded-xl px-4 py-3 text-white outline-none focus:ring-1 focus:ring-primary focus:border-primary cursor-pointer"
                                    >
                                        <option value="General">General</option>
                                        <option value="Business">Business</option>
                                        <option value="Issue">Issue</option>
                                        <option value="Complaint">Complaint</option>
                                        <option value="Feature Request">Feature Request</option>
                                        <option value="Billing">Billing</option>
                                    </select>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-white">Message</label>
                                <textarea
                                    rows={6}
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    placeholder="Tell us more about what you need help with..."
                                    required
                                    className="w-full bg-background-dark/50 border border-border-dark rounded-xl px-4 py-3 text-white focus:ring-1 focus:ring-primary focus:border-primary outline-none resize-none"
                                />
                            </div>
                            {result && (
                                <div className={`px-4 py-3 rounded-lg text-sm ${result.success ? 'bg-green-900/20 text-green-400 border border-green-900/30' : 'bg-red-900/20 text-red-400 border border-red-900/30'}`}>
                                    {result.message}
                                </div>
                            )}
                            <div className="flex justify-end gap-4 pt-4">
                                <button
                                    type="button"
                                    onClick={() => { setSubject(''); setMessage(''); setResult(null) }}
                                    className="text-[#b1b4a2] hover:text-white font-bold text-sm"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting || !subject.trim() || !message.trim()}
                                    className="px-6 py-3 bg-primary text-background-dark rounded-lg font-bold text-sm flex items-center gap-2 hover:bg-primary-hover disabled:opacity-60"
                                >
                                    {submitting ? 'Sending...' : 'Send Message'}{' '}
                                    <span className="material-symbols-outlined text-sm">send</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    )
}

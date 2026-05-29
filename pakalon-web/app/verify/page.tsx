'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

export default function VerifyPage() {
    const [code, setCode] = useState(['', '', '', '', '', ''])
    const inputs = useRef<(HTMLInputElement | null)[]>([])
    const router = useRouter()

    const handleChange = (val: string, index: number) => {
        if (!/^\d*$/.test(val)) return
        const newCode = [...code]
        newCode[index] = val.slice(-1)
        setCode(newCode)

        if (val && index < 5) {
            inputs.current[index + 1]?.focus()
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
        if (e.key === 'Backspace' && !code[index] && index > 0) {
            inputs.current[index - 1]?.focus()
        }
    }

    const isComplete = code.every((c) => c !== '')

    return (
        <div className="min-h-screen flex items-center justify-center relative p-6 bg-background-dark">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,#d7e19d05_0%,transparent_70%)] pointer-events-none"></div>

            <div className="w-full max-w-md bg-surface-dark border border-border-dark rounded-2xl shadow-2xl overflow-hidden">
                <div
                    className="relative h-32 bg-cover bg-center"
                    style={{
                        backgroundImage: `linear-gradient(to bottom, rgba(29,30,24,0.3), rgba(29,30,24,1)), url('https://picsum.photos/seed/secure/600/200')`,
                    }}
                >
                    <div className="absolute bottom-0 left-0 w-full p-6 pb-2 space-y-3">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/20 border border-primary/30 text-primary text-[10px] font-bold uppercase tracking-wider">
                            <span className="size-1.5 bg-primary rounded-full animate-ping"></span>
                            Login Attempt Detected
                        </div>
                        <h2 className="text-2xl font-bold">Verify Identity</h2>
                    </div>
                </div>

                <div className="p-6 pt-2 space-y-8">
                    <p className="text-sm text-[#b1b4a2] leading-relaxed">
                        A login request was initiated from your terminal. Please enter the 6-digit confirmation
                        code displayed in your CLI to continue.
                    </p>

                    <div className="flex justify-center gap-2">
                        {code.map((digit, i) => (
                            <div key={i} className="flex items-center">
                                <input
                                    ref={(el) => { inputs.current[i] = el }}
                                    type="text"
                                    value={digit}
                                    onChange={(e) => handleChange(e.target.value, i)}
                                    onKeyDown={(e) => handleKeyDown(e, i)}
                                    className="size-12 md:size-14 text-center bg-background-dark border border-border-dark rounded-lg text-2xl font-bold text-white focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                                />
                                {i === 2 && (
                                    <div className="flex items-center text-border-dark font-bold px-1">-</div>
                                )}
                            </div>
                        ))}
                    </div>

                    <button
                        onClick={() => router.push('/pricing')}
                        disabled={!isComplete}
                        className={`w-full h-12 rounded-lg font-bold flex items-center justify-center gap-2 transition-all ${isComplete
                                ? 'bg-primary text-background-dark hover:scale-[1.02]'
                                : 'bg-border-dark text-[#b1b4a2] cursor-not-allowed opacity-50'
                            }`}
                    >
                        Verify Session{' '}
                        <span className="material-symbols-outlined text-lg">arrow_forward</span>
                    </button>

                    <div className="pt-8 border-t border-border-dark flex gap-4">
                        <div className="p-2 rounded-lg bg-red-500/10 text-red-400">
                            <span className="material-symbols-outlined text-xl">shield</span>
                        </div>
                        <div className="flex-1 space-y-1">
                            <h3 className="text-sm font-bold">Not you?</h3>
                            <p className="text-[11px] text-[#b1b4a2]">
                                If you didn&apos;t request this login, someone might be trying to access your account.
                            </p>
                            <button className="text-[11px] font-bold text-red-400 flex items-center gap-1 hover:text-red-300">
                                Deny Access{' '}
                                <span className="material-symbols-outlined text-xs">close</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

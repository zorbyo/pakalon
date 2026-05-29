'use client'

import Image from 'next/image'
import { useEffect, useState, useRef, use } from 'react'
import { createClient } from '@/lib/supabase'
import { api } from '@/lib/api'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Stage = 'login' | 'verify' | 'success' | 'error'

interface WebConfirmResponse {
    status: string
    user_id: string
    plan: string
    message: string
    token: string
}

function extractErrorMessage(detail: unknown): string {
    if (typeof detail === 'string') {
        const trimmed = detail.trim()
        return trimmed || 'Verification failed'
    }

    if (Array.isArray(detail)) {
        const messages = detail
            .map((item) => extractErrorMessage(item))
            .filter((item) => item && item !== 'Verification failed')
        return messages.length ? messages.join(', ') : 'Verification failed'
    }

    if (detail && typeof detail === 'object') {
        const candidate = detail as Record<string, unknown>
        if ('detail' in candidate) return extractErrorMessage(candidate.detail)
        if ('message' in candidate) return extractErrorMessage(candidate.message)
        if ('error' in candidate) return extractErrorMessage(candidate.error)
        try {
            return JSON.stringify(candidate)
        } catch {
            return 'Verification failed'
        }
    }

    return 'Verification failed'
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function DeviceAuthPage({
    params,
}: {
    params: Promise<{ device_id: string }>
}) {
    const { device_id } = use(params)

    const [stage, setStage] = useState<Stage>('login')
    const [isCheckingSession, setIsCheckingSession] = useState(true)
    const [isConnecting, setIsConnecting] = useState(false)
    const [code, setCode] = useState(['', '', '', '', '', ''])
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [errorMsg, setErrorMsg] = useState<string | null>(null)
    const [successData, setSuccessData] = useState<WebConfirmResponse | null>(null)
    const inputs = useRef<(HTMLInputElement | null)[]>([])

    useEffect(() => {
        const supabase = createClient()
        supabase.auth.getSession().then(({ data }) => {
            setStage(data.session ? 'verify' : 'login')
            setIsCheckingSession(false)
        })

        const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
            setStage(session ? 'verify' : 'login')
            setIsCheckingSession(false)
        })

        return () => listener.subscription.unsubscribe()
    }, [])

    // ── Login stage: authenticate with GitHub, then return here for code verification ──
    const handleLogin = async () => {
        setIsConnecting(true)
        setErrorMsg(null)
        try {
            const supabase = createClient()
            const nextPath = `/${device_id}/auth?verified=1`
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'github',
                options: {
                    redirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(nextPath)}`,
                },
            })
            if (error) throw error
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'GitHub sign-in failed'
            setErrorMsg(message)
            setIsConnecting(false)
        }
    }

    // ── Code input helpers ──
    const handleCodeChange = (val: string, index: number) => {
        const normalized = val.toUpperCase().replace(/[^A-Z0-9]/g, '')
        if (!/^[A-Z0-9]*$/.test(normalized)) return
        const newCode = [...code]
        newCode[index] = normalized.slice(-1)
        setCode(newCode)
        if (normalized && index < 5) {
            inputs.current[index + 1]?.focus()
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
        if (e.key === 'Backspace' && !code[index] && index > 0) {
            inputs.current[index - 1]?.focus()
        }
    }

    const handlePaste = (e: React.ClipboardEvent) => {
        const pasted = e.clipboardData.getData('text').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
        if (!pasted) return
        e.preventDefault()
        const newCode = [...code]
        for (let i = 0; i < 6; i++) {
            newCode[i] = pasted[i] ?? ''
        }
        setCode(newCode)
        const focusIdx = Math.min(pasted.length, 5)
        inputs.current[focusIdx]?.focus()
    }

    const isComplete = code.every((c) => c !== '')

    const closeWindowSafely = () => {
        if (typeof window === 'undefined') return
        window.close()

        // Some browsers only allow close() for script-opened windows.
        // Retry with a self-open fallback before giving up.
        setTimeout(() => {
            if (window.closed) return
            window.open('', '_self')
            window.close()
        }, 50)
    }

    // ── Submit to backend ──
    const handleVerify = async () => {
        if (!isComplete || isSubmitting) return
        setIsSubmitting(true)
        setErrorMsg(null)

        try {
            const supabase = createClient()
            const {
                data: { session },
                error: sessionError,
            } = await supabase.auth.getSession()

            if (sessionError || !session) {
                throw sessionError ?? new Error('Please sign in with GitHub before verifying this device.')
            }

            const res = await fetch(`${API_BASE}/auth/devices/${device_id}/confirm`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                    code: code.join(''),
                }),
            })

            if (!res.ok) {
                const body = await res.json().catch(() => ({ detail: 'Verification failed' }))
                const message = extractErrorMessage((body as Record<string, unknown>)?.detail ?? body)
                throw new Error(message || `HTTP ${res.status}`)
            }

            const data: WebConfirmResponse = await res.json()
            // Store JWT so the web dashboard can make authenticated API calls
            if (data.token) {
                api.setToken(data.token)
            }
            setSuccessData(data)
            setStage('success')

            // Best effort auto-close after successful sign-in.
            // If the browser blocks it, the manual button is still available.
            setTimeout(() => {
                closeWindowSafely()
            }, 900)
        } catch (err: unknown) {
            setErrorMsg(extractErrorMessage(err instanceof Error ? err.message : err))
        } finally {
            setIsSubmitting(false)
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Background decorations (shared across all stages)
    // ─────────────────────────────────────────────────────────────────────────
    const Decorations = () => (
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-20">
            <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-primary rounded-full blur-[120px]" />
            <div className="absolute -bottom-[10%] -right-[10%] w-[40%] h-[40%] bg-primary/30 rounded-full blur-[120px]" />
        </div>
    )

    // ─────────────────────────────────────────────────────────────────────────
    // Stage: Login
    // ─────────────────────────────────────────────────────────────────────────
    if (stage === 'login') {
        return (
            <div className="min-h-screen flex items-center justify-center p-6 bg-background-dark relative">
                <Decorations />
                <div className="w-full max-w-md space-y-8 z-10">
                    <div className="text-center space-y-4">
                        <div className="mx-auto flex items-center justify-center">
                            <Image
                                src="/assets/Light_theme_TPBG.png"
                                alt="Pakalon"
                                width={265}
                                height={125}
                                className="h-[125px] w-auto object-contain"
                                priority
                            />
                        </div>
                        <div className="space-y-1">
                            <h1 className="text-3xl font-bold tracking-tight text-white">
                                CLI Login Request
                            </h1>
                            <p className="text-[#b1b4a2]">
                                A terminal session is waiting for you to authenticate
                            </p>
                        </div>
                    </div>

                    <div className="bg-surface-dark border border-border-dark p-8 rounded-2xl shadow-xl space-y-6">
                        {/* Device ID indicator */}
                        <div className="flex items-center gap-4 p-4 rounded-xl bg-background-dark/50 border border-border-dark">
                            <div className="size-10 bg-primary rounded-lg flex items-center justify-center text-background-dark shrink-0">
                                <span className="material-symbols-outlined font-bold">terminal</span>
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-white leading-none">Pakalon CLI</p>
                                <p className="text-[10px] text-primary uppercase font-bold tracking-widest mt-1">
                                    Device Auth Request
                                </p>
                                <p className="text-[10px] text-[#b1b4a2] mt-1 font-mono truncate">
                                    {device_id}
                                </p>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <div className="flex items-center gap-3 text-sm text-[#b1b4a2]">
                                <span className="material-symbols-outlined text-green-400 text-lg">check_circle</span>
                                <span>Read access to your public profile</span>
                            </div>
                            <div className="flex items-center gap-3 text-sm text-[#b1b4a2]">
                                <span className="material-symbols-outlined text-green-400 text-lg">check_circle</span>
                                <span>Email address verification</span>
                            </div>
                            <div className="flex items-center gap-3 text-sm text-[#b1b4a2]">
                                <span className="material-symbols-outlined text-green-400 text-lg">check_circle</span>
                                <span>Secure CLI session management</span>
                            </div>
                        </div>

                        {errorMsg && (
                            <p className="text-sm text-red-400 text-center px-2">{errorMsg}</p>
                        )}

                        <button
                            onClick={handleLogin}
                            disabled={isConnecting || isCheckingSession}
                            className={`w-full h-14 rounded-xl font-bold flex items-center justify-center gap-3 transition-all ${
                                isConnecting || isCheckingSession
                                    ? 'bg-surface-hover text-[#b1b4a2] cursor-not-allowed'
                                    : 'bg-white text-black hover:bg-gray-200 hover:scale-[1.01] active:scale-[0.98]'
                            }`}
                        >
                            {isConnecting || isCheckingSession ? (
                                <>
                                    <div className="size-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                                    {isCheckingSession ? 'Checking session…' : 'Connecting...'}
                                </>
                            ) : (
                                <>
                                    <svg height="20" viewBox="0 0 16 16" version="1.1" width="20" aria-hidden="true">
                                        <path
                                            fill="currentColor"
                                            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
                                        />
                                    </svg>
                                    Continue with GitHub
                                </>
                            )}
                        </button>

                        <p className="text-[11px] text-center text-[#b1b4a2] px-4">
                            By continuing, you agree to Pakalon&apos;s{' '}
                            <a href="#" className="underline hover:text-white">Terms of Service</a>{' '}
                            and{' '}
                            <a href="#" className="underline hover:text-white">Privacy Policy</a>.
                        </p>
                    </div>
                </div>
            </div>
        )
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Stage: Verify (enter 6-character code)
    // ─────────────────────────────────────────────────────────────────────────
    if (stage === 'verify') {
        return (
            <div className="min-h-screen flex items-center justify-center relative p-6 bg-background-dark">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,#d7e19d05_0%,transparent_70%)] pointer-events-none" />

                <div className="w-full max-w-md bg-surface-dark border border-border-dark rounded-2xl shadow-2xl overflow-hidden">
                    <div
                        className="relative h-32 bg-cover bg-center"
                        style={{
                            backgroundImage:
                                'linear-gradient(to bottom, rgba(29,30,24,0.3), rgba(29,30,24,1)), url(\'https://picsum.photos/seed/pakalon-cli/600/200\')',
                        }}
                    >
                        <div className="absolute bottom-0 left-0 w-full p-6 pb-2 space-y-3">
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/20 border border-primary/30 text-primary text-[10px] font-bold uppercase tracking-wider">
                                <span className="size-1.5 bg-primary rounded-full animate-ping" />
                                Login Attempt Detected
                            </div>
                            <h2 className="text-2xl font-bold">Verify Identity</h2>
                        </div>
                    </div>

                    <div className="p-6 pt-2 space-y-8">
                        <p className="text-sm text-[#b1b4a2] leading-relaxed">
                            A login request was initiated from your terminal. Please enter the 6-character
                            confirmation code displayed in your CLI to continue.
                        </p>

                        {/* Code inputs */}
                        <div className="flex justify-center gap-2" onPaste={handlePaste}>
                            {code.map((digit, i) => (
                                <div key={i} className="flex items-center">
                                    <input
                                        ref={(el) => { inputs.current[i] = el }}
                                        type="text"
                                        inputMode="text"
                                        autoCapitalize="characters"
                                        value={digit}
                                        onChange={(e) => handleCodeChange(e.target.value, i)}
                                        onKeyDown={(e) => handleKeyDown(e, i)}
                                        className="size-12 md:size-14 text-center bg-background-dark border border-border-dark rounded-lg text-2xl font-bold text-white focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
                                        maxLength={1}
                                    />
                                    {i === 2 && (
                                        <div className="flex items-center text-border-dark font-bold px-1">-</div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Error */}
                        {errorMsg && (
                            <div className="flex items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                                <span className="material-symbols-outlined text-red-400 text-lg">error</span>
                                <p className="text-sm text-red-400">{errorMsg}</p>
                            </div>
                        )}

                        <button
                            onClick={handleVerify}
                            disabled={!isComplete || isSubmitting}
                            className={`w-full h-12 rounded-lg font-bold flex items-center justify-center gap-2 transition-all ${
                                isComplete && !isSubmitting
                                    ? 'bg-primary text-background-dark hover:scale-[1.02] active:scale-[0.98]'
                                    : 'bg-border-dark text-[#b1b4a2] cursor-not-allowed opacity-50'
                            }`}
                        >
                            {isSubmitting ? (
                                <>
                                    <div className="size-5 border-2 border-background-dark/30 border-t-background-dark rounded-full animate-spin" />
                                    Verifying…
                                </>
                            ) : (
                                <>
                                    Verify Session{' '}
                                    <span className="material-symbols-outlined text-lg">arrow_forward</span>
                                </>
                            )}
                        </button>

                        <div className="pt-6 border-t border-border-dark flex gap-4">
                            <div className="p-2 rounded-lg bg-red-500/10 text-red-400">
                                <span className="material-symbols-outlined text-xl">shield</span>
                            </div>
                            <div className="flex-1 space-y-1">
                                <h3 className="text-sm font-bold">Not you?</h3>
                                <p className="text-[11px] text-[#b1b4a2]">
                                    If you didn&apos;t initiate this login, someone may be trying to access your account.
                                </p>
                                <button
                                    className="text-[11px] font-bold text-red-400 flex items-center gap-1 hover:text-red-300 transition-colors"
                                    onClick={closeWindowSafely}
                                >
                                    Dismiss{' '}
                                    <span className="material-symbols-outlined text-xs">close</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Stage: Success
    // ─────────────────────────────────────────────────────────────────────────
    if (stage === 'success') {
        return (
            <div className="min-h-screen flex items-center justify-center p-6 bg-background-dark relative">
                <Decorations />
                <div className="w-full max-w-md z-10 space-y-8 text-center">
                    <div className="mx-auto flex items-center justify-center">
                        <Image
                            src="/assets/Light_theme_TPBG.png"
                            alt="Pakalon"
                            width={265}
                            height={125}
                            className="h-[125px] w-auto object-contain"
                            priority
                        />
                    </div>

                    <div className="bg-surface-dark border border-border-dark p-8 rounded-2xl shadow-xl space-y-6">
                        <div className="mx-auto size-16 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center">
                            <span className="material-symbols-outlined text-green-400 text-3xl">check_circle</span>
                        </div>

                        <div className="space-y-2">
                            <h2 className="text-2xl font-bold text-white">Authentication Successful</h2>
                            <p className="text-[#b1b4a2] leading-relaxed">
                                {successData?.message ??
                                    'Authentication successful! You may close this window and start building applications using Pakalon.'}
                            </p>
                        </div>

                        {successData && (
                            <div className="flex items-center gap-3 p-4 rounded-xl bg-background-dark/50 border border-border-dark text-left">
                                <div className="size-10 bg-primary rounded-lg flex items-center justify-center text-background-dark shrink-0">
                                    <span className="material-symbols-outlined font-bold">person</span>
                                </div>
                                <div>
                                    <p className="text-xs text-[#b1b4a2] uppercase tracking-widest font-bold">
                                        {successData.plan} Plan
                                    </p>
                                    <p className="text-sm text-white font-mono mt-0.5">
                                        {successData.user_id.slice(0, 8)}…
                                    </p>
                                </div>
                            </div>
                        )}

                        <div className="pt-2 space-y-2">
                            <p className="text-sm text-[#b1b4a2]">
                                Your terminal is now authenticated. Switch back to your terminal to continue.
                            </p>
                            <button
                                onClick={() => { window.location.href = '/dashboard' }}
                                className="w-full h-12 rounded-lg font-bold bg-primary text-background-dark hover:scale-[1.02] active:scale-[0.98] transition-all"
                            >
                                View Dashboard
                            </button>
                            <button
                                onClick={closeWindowSafely}
                                className="w-full h-12 rounded-lg font-bold border border-border-dark text-white hover:bg-surface-dark transition-colors"
                            >
                                Close Window
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Stage: Error fallback (unreachable in normal flow)
    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-background-dark relative">
            <Decorations />
            <div className="w-full max-w-md z-10 bg-surface-dark border border-border-dark p-8 rounded-2xl space-y-4 text-center">
                <span className="material-symbols-outlined text-red-400 text-5xl block">error</span>
                <h2 className="text-xl font-bold text-white">Something went wrong</h2>
                <p className="text-[#b1b4a2]">{errorMsg ?? 'An unexpected error occurred.'}</p>
                <button
                    onClick={() => { setErrorMsg(null); setStage('login') }}
                    className="w-full h-12 rounded-lg font-bold bg-border-dark text-white hover:bg-surface-hover transition-colors"
                >
                    Try Again
                </button>
            </div>
        </div>
    )
}

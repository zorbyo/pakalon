'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { api } from '@/lib/api'

/**
 * Client page that finalises login after the server Route Handler has
 * exchanged the OAuth code and stored the Supabase session in cookies.
 *
 * Steps:
 *  1. Read the active Supabase session (already in cookies from /api/auth/callback)
 *  2. POST the Supabase access token to the backend /auth/web-signin
 *  3. Store the returned Pakalon JWT in localStorage
 *  4. Redirect to /dashboard
 */
function AuthExchangeContent() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [status, setStatus] = useState('Completing sign-in…')
    const nextPath = (() => {
        const rawNext = searchParams.get('next') || '/dashboard'
        return rawNext.startsWith('/') ? rawNext : '/dashboard'
    })()

    useEffect(() => {
        ;(async () => {
            try {
                const supabase = createClient()
                const { data: { session }, error } = await supabase.auth.getSession()

                if (error || !session) {
                    throw error ?? new Error('No active session found')
                }

                const user = session.user
                const meta = user.user_metadata ?? {}
                const github_login =
                    meta.user_name ??
                    meta.preferred_username ??
                    meta.login ??
                    user.id

                setStatus('Creating your Pakalon account…')
                const res = await api.webSignIn(
                    session.access_token,
                    github_login,
                    user.email,
                    meta.full_name ?? meta.name ?? undefined,
                )

                api.setToken(res.token)
                router.replace(nextPath)
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Sign-in failed'
                setStatus(`Error: ${msg}. Redirecting to login…`)
                setTimeout(() => {
                    router.replace(`/login?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent(msg)}`)
                }, 2500)
            }
        })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nextPath, router])

    return (
        <div className="min-h-screen flex items-center justify-center bg-background-dark">
            <div className="flex flex-col items-center gap-4">
                <div className="size-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                <p className="text-[#b1b4a2] text-sm">{status}</p>
            </div>
        </div>
    )
}

export default function AuthExchangePage() {
    return (
        <Suspense
            fallback={
                <div className="min-h-screen flex items-center justify-center bg-background-dark">
                    <div className="flex flex-col items-center gap-4">
                        <div className="size-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                        <p className="text-[#b1b4a2] text-sm">Completing sign-in…</p>
                    </div>
                </div>
            }
        >
            <AuthExchangeContent />
        </Suspense>
    )
}

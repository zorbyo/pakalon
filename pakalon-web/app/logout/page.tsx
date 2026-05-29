'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { api } from '@/lib/api'

function LogoutContent() {
    const router = useRouter()
    const searchParams = useSearchParams()

    useEffect(() => {
        let cancelled = false

        const run = async () => {
            const token = api.getToken()
            if (token) {
                const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
                await fetch(`${apiBase}/auth/logout`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                }).catch(() => undefined)
            }

            api.clearToken()

            try {
                const supabase = createClient()
                await supabase.auth.signOut({ scope: 'global' })
            } catch {
                // Best-effort sign-out; we still clear the Pakalon token and continue.
            }

            if (cancelled) return

            const nextPath = searchParams.get('next') || '/login?logged_out=1'
            router.replace(nextPath.startsWith('/') ? nextPath : '/login?logged_out=1')
        }

        void run()

        return () => {
            cancelled = true
        }
    }, [router, searchParams])

    return (
        <div className="min-h-screen flex items-center justify-center bg-background-dark">
            <div className="flex flex-col items-center gap-4">
                <div className="size-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                <p className="text-[#b1b4a2] text-sm">Signing you out…</p>
            </div>
        </div>
    )
}

export default function LogoutPage() {
    return (
        <Suspense
            fallback={
                <div className="min-h-screen flex items-center justify-center bg-background-dark">
                    <div className="flex flex-col items-center gap-4">
                        <div className="size-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                        <p className="text-[#b1b4a2] text-sm">Signing you out…</p>
                    </div>
                </div>
            }
        >
            <LogoutContent />
        </Suspense>
    )
}
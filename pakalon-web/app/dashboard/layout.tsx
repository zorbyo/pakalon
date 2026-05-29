'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { api } from '@/lib/api'
import { createClient } from '@/lib/supabase'

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const router = useRouter()
    const [verified, setVerified] = useState(false)
    const [status, setStatus] = useState('Verifying your session…')

    useEffect(() => {
        let active = true

        const bootstrapDashboardSession = async () => {
            try {
                const ensurePakalonToken = async () => {
                    const existingToken = api.getToken()
                    if (existingToken) {
                        return existingToken
                    }

                    setStatus('Restoring your Pakalon session…')
                    const supabase = createClient()
                    const {
                        data: { session },
                        error,
                    } = await supabase.auth.getSession()

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

                    const response = await api.webSignIn(
                        session.access_token,
                        github_login,
                        user.email,
                        meta.full_name ?? meta.name ?? undefined,
                    )

                    api.setToken(response.token)
                    return response.token
                }

                await ensurePakalonToken()

                setStatus('Loading your dashboard…')
                await api.getMe()
                if (active) {
                    setVerified(true)
                }
            } catch (err: any) {
                api.clearToken()
                if (active) {
                    const errMsg = err?.message || 'Session verification failed'
                    router.replace(`/login?next=%2Fdashboard&error=${encodeURIComponent(errMsg)}`)
                }
            }
        }

        void bootstrapDashboardSession()

        return () => {
            active = false
        }
    }, [router])

    if (!verified) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background-dark">
                <div className="flex flex-col items-center gap-4">
                    <div className="size-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                    <p className="text-sm text-[#b1b4a2]">{status}</p>
                </div>
            </div>
        )
    }

    return (
        <div className="flex h-screen w-full bg-background-dark overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-y-auto bg-background-dark">
                {children}
            </main>
        </div>
    )
}

'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

/**
 * Fallback page — OAuth flow now uses /api/auth/callback (Route Handler).
 * If someone lands here directly, forward them to the API route with the code.
 */
function AuthCallbackContent() {
    const router = useRouter()
    const searchParams = useSearchParams()

    useEffect(() => {
        const code = searchParams.get('code')
        if (code) {
            window.location.href = `/api/auth/callback?code=${code}`
        } else {
            router.replace('/login')
        }
    }, [router, searchParams])

    return (
        <div className="min-h-screen flex items-center justify-center bg-background-dark">
            <div className="size-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
    )
}

export default function AuthCallbackFallback() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-background-dark" />}>
            <AuthCallbackContent />
        </Suspense>
    )
}


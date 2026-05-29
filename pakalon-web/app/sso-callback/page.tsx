'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Legacy SSO callback route kept for any saved bookmarks.
 * Supabase sends OAuth callbacks directly to /auth/callback.
 */
export default function SSOCallbackPage() {
    const router = useRouter()
    useEffect(() => { router.replace('/auth/callback') }, [router])
    return (
        <div className="min-h-screen flex items-center justify-center bg-background-dark">
            <div className="size-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
    )
}

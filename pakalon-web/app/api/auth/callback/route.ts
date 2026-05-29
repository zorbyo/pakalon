import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase'

/**
 * Server-side Route Handler for Supabase GitHub OAuth PKCE callback.
 *
 * Supabase redirects here with ?code=... after the user authorises with GitHub.
 * We exchange the code for a session server-side (cookies are available here),
 * store the session in cookies, then redirect to /auth/exchange where the
 * client-side code picks up the session and obtains a Pakalon JWT.
 */
export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')
    const error = searchParams.get('error')
    const nextPath = (() => {
        const rawNext = searchParams.get('next') || '/dashboard'
        return rawNext.startsWith('/') ? rawNext : '/dashboard'
    })()

    if (error || !code) {
        const msg = error ?? 'no_code'
        return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(msg)}`)
    }

    const cookieStore = await cookies()
    const supabase = createServerClient(cookieStore)

    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

    if (exchangeError) {
        console.error('[auth/callback] Code exchange failed:', exchangeError.message)
        return NextResponse.redirect(
            `${origin}/login?error=${encodeURIComponent(exchangeError.message)}`
        )
    }

    // Session is now stored in cookies — redirect to client page for Pakalon JWT exchange
    return NextResponse.redirect(`${origin}/auth/exchange?next=${encodeURIComponent(nextPath)}`)
}

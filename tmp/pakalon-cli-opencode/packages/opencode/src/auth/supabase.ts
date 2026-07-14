import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { Global } from "../global"
import path from "path"
import { Pakalon } from "../pakalon"

const log = Log.create({ service: "auth:supabase" })

export interface PakalonAuth {
  accessToken: string
  refreshToken: string
  expiresAt: number
  userId: string
  email: string
  plan: "free" | "pro"
  provider: "github"
}

const authFile = path.join(Global.Path.data, Pakalon.AUTH_FILE)

export namespace SupabaseAuth {
  let cached: PakalonAuth | undefined

  export async function getAuth(): Promise<PakalonAuth | undefined> {
    if (cached && cached.expiresAt > Date.now()) return cached
    try {
      const data = await Filesystem.readJson<PakalonAuth>(authFile)
      if (data.expiresAt > Date.now()) {
        cached = data
        return data
      }
      return await refreshAuth(data.refreshToken)
    } catch {
      return undefined
    }
  }

  export async function saveAuth(auth: PakalonAuth): Promise<void> {
    cached = auth
    await Filesystem.writeJson(authFile, auth, 0o600)
    log.info("saved auth", { email: auth.email, plan: auth.plan })
  }

  export async function clearAuth(): Promise<void> {
    cached = undefined
    try {
      const { unlink } = await import("fs/promises")
      await unlink(authFile)
    } catch {}
    log.info("cleared auth")
  }

  export async function isAuthenticated(): Promise<boolean> {
    const auth = await getAuth()
    return auth !== undefined
  }

  export async function getPlan(): Promise<"free" | "pro"> {
    const auth = await getAuth()
    return auth?.plan ?? "free"
  }

  export async function getUserId(): Promise<string | undefined> {
    const auth = await getAuth()
    return auth?.userId
  }

  export async function getEmail(): Promise<string | undefined> {
    const auth = await getAuth()
    return auth?.email
  }

  async function refreshAuth(refreshToken: string): Promise<PakalonAuth | undefined> {
    log.info("refreshing auth token")
    const url = `${Pakalon.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: Pakalon.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      if (!res.ok) return undefined
      const data = await res.json()
      const auth: PakalonAuth = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
        userId: data.user.id,
        email: data.user.email,
        plan: data.user.user_metadata?.plan ?? "free",
        provider: "github",
      }
      await saveAuth(auth)
      return auth
    } catch {
      log.warn("failed to refresh auth")
      return undefined
    }
  }

  export async function signInWithGitHub(): Promise<{ url: string; code: string }> {
    const code = Pakalon.generateDeviceCode()
    const url = `${Pakalon.SUPABASE_URL}/auth/v1/authorize?provider=github&redirect_to=http://localhost:9876/callback`
    log.info("initiating GitHub OAuth", { code })
    return { url, code }
  }

  export function formatAuthStatus(auth: PakalonAuth): string {
    const expiry = new Date(auth.expiresAt).toLocaleDateString()
    return [
      `Email: ${auth.email}`,
      `Plan: ${auth.plan.toUpperCase()}`,
      `Provider: ${auth.provider}`,
      `Expires: ${expiry}`,
    ].join("\n")
  }
}

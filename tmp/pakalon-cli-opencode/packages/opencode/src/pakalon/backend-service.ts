/**
 * Pakalon Backend Service
 * 
 * Handles backend integration:
 * - Device code authentication
 * - Session syncing
 * - Usage tracking
 * - Billing integration
 */

import { Log } from "../util/log"
import { Flag } from "../flag/flag"
import { Filesystem } from "../util/filesystem"
import { Pakalon } from "./index"
import { TelemetryManager } from "./telemetry-manager"
import path from "path"
import os from "os"

const log = Log.create({ service: "pakalon:backend" })

export interface AuthState {
  authenticated: boolean
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  userId?: string
  email?: string
  plan: "free" | "pro"
}

export interface UsageStats {
  totalPrompts: number
  totalTokens: number
  sessionsCount: number
  lastActive: number
}

export interface DeviceCodeResponse {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export namespace BackendService {
  const AUTH_FILE = path.join(os.homedir(), ".config", "Pakalon", "auth.json")
  
  let authState: AuthState | null = null

  /**
   * Get backend URL
   */
  function getBackendUrl(): string {
    return Flag.PAKALON_BACKEND_URL || "http://localhost:8000"
  }

  /**
   * Check if backend is enabled
   */
  export function isEnabled(): boolean {
    return Flag.PAKALON_ENABLE_BACKEND !== false
  }

  /**
   * Load auth state from disk
   */
  export async function loadAuthState(): Promise<AuthState | null> {
    if (authState) return authState

    try {
      authState = await Filesystem.readJson<AuthState>(AUTH_FILE)
      return authState
    } catch {
      return null
    }
  }

  /**
   * Save auth state to disk
   */
  export async function saveAuthState(state: AuthState): Promise<void> {
    authState = state
    try {
      await Filesystem.writeJson(AUTH_FILE, state)
      log.info("Auth state saved")
    } catch (error) {
      log.error("Failed to save auth state", { error })
    }
  }

  /**
   * Check if user is authenticated
   */
  export async function isAuthenticated(): Promise<boolean> {
    const state = await loadAuthState()
    if (!state) return false
    if (!state.accessToken) return false
    if (state.expiresAt && state.expiresAt < Date.now()) return false
    return true
  }

  /**
   * Get current auth state
   */
  export async function getAuthState(): Promise<AuthState | null> {
    return loadAuthState()
  }

  /**
   * Start device code flow
   */
  export async function startDeviceCodeFlow(): Promise<DeviceCodeResponse | null> {
    if (!isEnabled()) {
      log.info("Backend is disabled")
      return null
    }

    try {
      const response = await fetch(`${getBackendUrl()}/auth/device/code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: "pakalon-cli",
          scope: "openid profile email",
        }),
      })

      if (!response.ok) {
        throw new Error(`Device code request failed: ${response.status}`)
      }

      const data = await response.json()
      return {
        deviceCode: data.device_code,
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        expiresIn: data.expires_in,
        interval: data.interval,
      }
    } catch (error) {
      log.error("Failed to start device code flow", { error })
      return null
    }
  }

  /**
   * Poll for device code completion
   */
  export async function pollDeviceCode(deviceCode: string, interval: number): Promise<AuthState | null> {
    const maxAttempts = 60 // 5 minutes with 5-second interval
    let attempts = 0

    while (attempts < maxAttempts) {
      try {
        const response = await fetch(`${getBackendUrl()}/auth/device/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "urn:ietf:params:oauth:grant_type:device_code",
            device_code: deviceCode,
            client_id: "pakalon-cli",
          }),
        })

        if (response.ok) {
          const data = await response.json()
          const state: AuthState = {
            authenticated: true,
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + (data.expires_in * 1000),
            userId: data.user_id,
            email: data.email,
            plan: data.plan || "free",
          }

          await saveAuthState(state)
          await TelemetryManager.trackEvent({
            type: "auth_success",
            timestamp: Date.now(),
            data: { userId: state.userId, plan: state.plan },
          })

          return state
        }

        // Check for pending authorization
        if (response.status === 400) {
          const error = await response.json()
          if (error.error === "authorization_pending") {
            await new Promise(resolve => setTimeout(resolve, interval * 1000))
            attempts++
            continue
          }
          if (error.error === "slow_down") {
            await new Promise(resolve => setTimeout(resolve, (interval + 5) * 1000))
            attempts++
            continue
          }
        }

        throw new Error(`Token request failed: ${response.status}`)
      } catch (error) {
        log.error("Device code poll error", { error })
        return null
      }
    }

    log.warn("Device code flow timed out")
    return null
  }

  /**
   * Logout
   */
  export async function logout(): Promise<void> {
    authState = null
    try {
      await Filesystem.writeJson(AUTH_FILE, { authenticated: false, plan: "free" })
    } catch {}
    log.info("Logged out")
  }

  /**
   * Refresh access token
   */
  export async function refreshToken(): Promise<boolean> {
    const state = await loadAuthState()
    if (!state?.refreshToken) return false

    try {
      const response = await fetch(`${getBackendUrl()}/auth/token/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: state.refreshToken,
          client_id: "pakalon-cli",
        }),
      })

      if (!response.ok) return false

      const data = await response.json()
      state.accessToken = data.access_token
      state.expiresAt = Date.now() + (data.expires_in * 1000)
      if (data.refresh_token) state.refreshToken = data.refresh_token

      await saveAuthState(state)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get user plan
   */
  export async function getUserPlan(): Promise<"free" | "pro"> {
    const state = await loadAuthState()
    return state?.plan || "free"
  }

  /**
   * Sync usage to backend
   */
  export async function syncUsage(stats: UsageStats): Promise<void> {
    if (!isEnabled()) return
    const state = await loadAuthState()
    if (!state?.accessToken) return

    try {
      await fetch(`${getBackendUrl()}/usage/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${state.accessToken}`,
        },
        body: JSON.stringify(stats),
      })
    } catch (error) {
      log.error("Failed to sync usage", { error })
    }
  }

  /**
   * Get usage stats from backend
   */
  export async function getUsageStats(): Promise<UsageStats | null> {
    if (!isEnabled()) return null
    const state = await loadAuthState()
    if (!state?.accessToken) return null

    try {
      const response = await fetch(`${getBackendUrl()}/usage/stats`, {
        headers: { Authorization: `Bearer ${state.accessToken}` },
      })

      if (!response.ok) return null
      return response.json()
    } catch {
      return null
    }
  }

  /**
   * Check if feature is allowed based on plan
   */
  export async function isFeatureAllowed(feature: string): Promise<boolean> {
    const plan = await getUserPlan()
    
    // Free plan restrictions
    const proOnlyFeatures = [
      "semgrep",
      "owasp-zap",
      "nikto",
      "advanced-penpot",
    ]

    if (plan === "free" && proOnlyFeatures.includes(feature)) {
      return false
    }

    return true
  }
}

export default BackendService

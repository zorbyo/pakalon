import { Log } from "../util/log"
import { getClient } from "./client"
import type {
  DeviceCodeCreateRequest,
  DeviceCodeCreateResponse,
  DeviceCodePollResponse,
  DeviceCodeConfirmRequest,
  DeviceCodeConfirmResponse,
  DeviceCodeWebConfirmRequest,
  DeviceCodeWebConfirmResponse,
  WebSignInRequest,
  WebSignInResponse,
  LogoutResponse,
  User,
} from "./types"
import { MachineId } from "../telemetry/machine-id"

const log = Log.create({ service: "backend:auth" })

export interface AuthResult {
  token: string
  user: User
}

export namespace AuthBackend {
  const POLL_INTERVAL = 3000
  const MAX_POLL_ATTEMPTS = 60

  export async function createDeviceCode(machineId?: string): Promise<DeviceCodeCreateResponse> {
    const client = getClient()
    const mid = machineId || (await MachineId.get())

    const request: DeviceCodeCreateRequest = {
      device_id: undefined,
      machine_id: mid,
    }

    log.info("creating device code", { machine_id: mid })
    const response = await client.post<DeviceCodeCreateResponse>("/auth/devices", request)
    log.info("device code created", { device_id: response.device_id, code: response.code })
    return response
  }

  export async function pollDeviceToken(deviceId: string): Promise<DeviceCodePollResponse> {
    const client = getClient()
    return client.get<DeviceCodePollResponse>(`/auth/devices/${deviceId}/token`)
  }

  export async function waitForAuth(
    deviceId: string,
    onStatus?: (status: DeviceCodePollResponse) => void,
  ): Promise<AuthResult> {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      const status = await pollDeviceToken(deviceId)
      onStatus?.(status)

      if (status.status === "approved") {
        const token = status.token || status.access_token
        if (!token) {
          throw new Error("No token in approved response")
        }
        getClient().setToken(token)
        const user: User = {
          id: status.user_id || "",
          email: status.display_name || "",
          github_login: status.github_login || "",
          plan: (status.plan as "free" | "pro") || "free",
          trial_days_used: 0,
          trial_days_remaining: status.trial_days_remaining || 0,
          is_admin: false,
        }
        log.info("authentication successful", { user_id: user.id, plan: user.plan })
        return { token, user }
      }

      if (status.status === "expired") {
        throw new Error("Device code expired")
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL))
    }

    throw new Error("Authentication timed out")
  }

  export async function confirmDeviceCode(
    deviceId: string,
    code: string,
  ): Promise<DeviceCodeConfirmResponse> {
    const client = getClient()
    const request: DeviceCodeConfirmRequest = { code }
    return client.post<DeviceCodeConfirmResponse>(`/auth/devices/${deviceId}/confirm`, request)
  }

  export async function webConfirmDeviceCode(
    deviceId: string,
    code: string,
    email: string,
    githubLogin: string,
    displayName?: string,
  ): Promise<DeviceCodeWebConfirmResponse> {
    const client = getClient()
    const request: DeviceCodeWebConfirmRequest = {
      code,
      email,
      github_login: githubLogin,
      display_name: displayName,
    }
    return client.post<DeviceCodeWebConfirmResponse>(
      `/auth/devices/${deviceId}/web-confirm`,
      request,
    )
  }

  export async function webSignIn(
    githubLogin: string,
    email: string,
    displayName?: string,
  ): Promise<WebSignInResponse> {
    const client = getClient()
    const request: WebSignInRequest = {
      github_login: githubLogin,
      email,
      display_name: displayName,
    }
    const response = await client.post<WebSignInResponse>("/auth/web-signin", request)
    client.setToken(response.token)
    return response
  }

  export async function logout(): Promise<LogoutResponse> {
    const client = getClient()
    const response = await client.post<LogoutResponse>("/auth/logout")
    client.setToken(null)
    return response
  }

  export function formatCode(code: string): string {
    if (code.length !== 6) return code
    return `${code.slice(0, 3)}-${code.slice(3)}`
  }
}

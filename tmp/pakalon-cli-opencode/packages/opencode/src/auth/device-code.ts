import { Log } from "../util/log"
import * as Backend from "../backend"
import { MachineId } from "../telemetry/machine-id"
import { Auth } from "./index"

const log = Log.create({ service: "auth:device-code" })

export interface DeviceCode {
  code: string
  url: string
  expiresAt: number
  interval: number
  deviceId: string
}

export interface DeviceCodeStatus {
  status: "pending" | "authorized" | "expired" | "denied"
  accessToken?: string
  refreshToken?: string
  user?: {
    id: string
    email: string
    plan: "free" | "pro"
    github_login?: string
  }
}

export namespace DeviceCodeFlow {
  const POLL_INTERVAL = 3000
  const EXPIRY = 600_000

  export async function generate(): Promise<DeviceCode> {
    try {
      const response = await Backend.AuthBackend.createDeviceCode(await MachineId.get())
      
      log.info("generated device code", { code: response.code, deviceId: response.device_id })
      
      return {
        code: response.code,
        url: response.verification_url,
        expiresAt: Date.now() + (response.expires_in * 1000),
        interval: POLL_INTERVAL,
        deviceId: response.device_id,
      }
    } catch (error) {
      log.error("failed to generate device code", { error })
      throw error
    }
  }

  export async function poll(deviceCode: DeviceCode): Promise<DeviceCodeStatus> {
    if (Date.now() > deviceCode.expiresAt) {
      return { status: "expired" }
    }

    try {
      const response = await Backend.AuthBackend.pollDeviceToken(deviceCode.deviceId)

      if (response.status === "pending") {
        return { status: "pending" }
      }

      if (response.status === "approved") {
        const token = response.token || response.access_token
        if (token) {
          Backend.getClient().setToken(token)
          return {
            status: "authorized",
            accessToken: token,
            user: {
              id: response.user_id || "",
              email: response.display_name || "",
              plan: (response.plan as "free" | "pro") || "free",
              github_login: response.github_login,
            },
          }
        }
      }

      if (response.status === "expired") {
        return { status: "expired" }
      }

      return { status: "pending" }
    } catch (error) {
      log.warn("poll failed", { error })
      return { status: "pending" }
    }
  }

  export async function waitForAuth(
    deviceCode: DeviceCode,
    onStatus?: (status: DeviceCodeStatus) => void,
  ): Promise<DeviceCodeStatus> {
    while (true) {
      const status = await poll(deviceCode)
      onStatus?.(status)
      if (status.status !== "pending") return status
      await new Promise((r) => setTimeout(r, deviceCode.interval))
    }
  }

  export async function authenticate(): Promise<{
    token: string
    user: DeviceCodeStatus["user"]
  }> {
    const deviceCode = await generate()
    const status = await DeviceCodeFlow.waitForAuth(deviceCode, (s) => {
      log.info("auth status", { status: s.status })
    })

    if (status.status !== "authorized" || !status.accessToken) {
      throw new Error(`Authentication failed: ${status.status}`)
    }

    await Auth.set("pakalon", {
      type: "api",
      key: status.accessToken,
    })

    return {
      token: status.accessToken,
      user: status.user,
    }
  }

  export function isExpired(deviceCode: DeviceCode): boolean {
    return Date.now() > deviceCode.expiresAt
  }

  export function formatCode(code: string): string {
    if (code.length !== 6) return code
    return `${code.slice(0, 3)}-${code.slice(3)}`
  }
}

import path from "path"
import fs from "fs/promises"
import { Global } from "../../global"
import { Filesystem } from "../../util/filesystem"

export type RateLimitMockProfile = "off" | "soft" | "hard" | "extra-usage-required"

export interface RateLimitMockState {
  enabled: boolean
  profile: Exclude<RateLimitMockProfile, "off"> | "off"
  updatedAt?: string
  reason?: string
}

const DEFAULT_STATE: RateLimitMockState = {
  enabled: false,
  profile: "off",
}

const STATE_FILE = path.join(Global.Path.state, "rate-limit-mock.json")

export function getRateLimitMockFilePath(): string {
  return STATE_FILE
}

export async function readRateLimitMockState(): Promise<RateLimitMockState> {
  const parsed = await Filesystem.readJson<RateLimitMockState>(STATE_FILE).catch(() => undefined)
  if (!parsed || typeof parsed !== "object") return DEFAULT_STATE

  const profile = parsed.profile
  const isKnownProfile =
    profile === "off" ||
    profile === "soft" ||
    profile === "hard" ||
    profile === "extra-usage-required"

  if (!isKnownProfile) return DEFAULT_STATE

  return {
    enabled: parsed.enabled === true && profile !== "off",
    profile,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
    reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
  }
}

export async function writeRateLimitMockState(
  profile: Exclude<RateLimitMockProfile, "off">,
  reason?: string,
): Promise<RateLimitMockState> {
  const next: RateLimitMockState = {
    enabled: true,
    profile,
    updatedAt: new Date().toISOString(),
    reason: reason?.trim() ? reason.trim() : undefined,
  }

  await Filesystem.writeJson(STATE_FILE, next)
  return next
}

export async function clearRateLimitMockState(): Promise<void> {
  await fs.rm(STATE_FILE, { force: true }).catch(() => undefined)
}

import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import {
  type CavemanMode,
  getCavemanConfig,
  getModeDisplayName,
  formatModeBadge,
} from "./caveman-config"
import { compressText, shouldUseNormalMode } from "./caveman"

export const CavemanStatusLog = Log.create({ service: "caveman.status" })

interface CavemanSessionState {
  mode: CavemanMode
  normalModeOverride: boolean
  activatedAt: number
  compressionCount: number
  charactersSaved: number
}

const state = Instance.state(() => {
  const sessions = new Map<string, CavemanSessionState>()
  return {
    sessions,
    globalMode: "off" as CavemanMode,
    initialized: false,
  }
})

export interface CavemanStatus {
  active: boolean
  mode: CavemanMode
  modeDisplay: string
  badge: string
  globalMode: CavemanMode
}

export function getCavemanStatus(): CavemanStatus {
  const s = state()
  const config = getCavemanConfig()
  const mode = s.globalMode

  return {
    active: mode !== "off",
    mode,
    modeDisplay: getModeDisplayName(mode),
    badge: formatModeBadge(mode),
    globalMode: s.globalMode,
  }
}

export function getSessionCavemanState(
  sessionID: string
): CavemanSessionState | undefined {
  return state().sessions.get(sessionID)
}

export function initCavemanForSession(sessionID: string): void {
  const s = state()
  const config = getCavemanConfig()

  if (config.autoActivate && config.defaultMode !== "off") {
    s.sessions.set(sessionID, {
      mode: config.defaultMode,
      normalModeOverride: false,
      activatedAt: Date.now(),
      compressionCount: 0,
      charactersSaved: 0,
    })
    CavemanStatusLog.info("caveman initialized for session", {
      sessionID,
      mode: config.defaultMode,
    })
  }
}

export function setCavemanModeForSession(
  sessionID: string,
  mode: CavemanMode
): void {
  const s = state()

  if (mode === "off") {
    s.sessions.delete(sessionID)
    s.globalMode = "off"
    CavemanStatusLog.info("caveman deactivated for session", { sessionID })
  } else {
    const existing = s.sessions.get(sessionID)
    s.sessions.set(sessionID, {
      mode,
      normalModeOverride: existing?.normalModeOverride ?? false,
      activatedAt: existing?.activatedAt ?? Date.now(),
      compressionCount: 0,
      charactersSaved: 0,
    })
    s.globalMode = mode
    CavemanStatusLog.info("caveman mode set for session", { sessionID, mode })
  }
}

export function getCavemanModeForSession(sessionID: string): CavemanMode {
  const sessionState = state().sessions.get(sessionID)
  if (sessionState) {
    return sessionState.mode
  }
  return state().globalMode
}

export function isCavemanActiveForSession(sessionID: string): boolean {
  const mode = getCavemanModeForSession(sessionID)
  return mode !== "off"
}

export function setNormalModeOverride(
  sessionID: string,
  override: boolean
): void {
  const sessionState = state().sessions.get(sessionID)
  if (sessionState) {
    sessionState.normalModeOverride = override
  }
}

export function shouldCompressForSession(sessionID: string): boolean {
  const sessionState = state().sessions.get(sessionID)
  if (!sessionState) return false

  if (sessionState.mode === "off") return false
  if (sessionState.normalModeOverride) return false

  const config = getCavemanConfig()
  return config.compressOutput
}

export function recordCompression(
  sessionID: string,
  originalLength: number,
  compressedLength: number
): void {
  const sessionState = state().sessions.get(sessionID)
  if (sessionState) {
    sessionState.compressionCount++
    sessionState.charactersSaved += originalLength - compressedLength
  }
}

export function getCompressionStats(
  sessionID: string
): { count: number; saved: number } | undefined {
  const sessionState = state().sessions.get(sessionID)
  if (!sessionState) return undefined
  return {
    count: sessionState.compressionCount,
    saved: sessionState.charactersSaved,
  }
}

export function cleanupSession(sessionID: string): void {
  state().sessions.delete(sessionID)
  CavemanStatusLog.info("caveman session cleanup", { sessionID })
}

export function compressTextForSession(
  sessionID: string,
  text: string
): { compressed: string; wasCompressed: boolean } {
  const mode = getCavemanModeForSession(sessionID)

  if (mode === "off") {
    return { compressed: text, wasCompressed: false }
  }

  if (shouldUseNormalMode(text)) {
    setNormalModeOverride(sessionID, true)
    return { compressed: text, wasCompressed: false }
  }

  const originalLength = text.length
  const compressed = compressText(text, mode)
  const wasCompressed = compressed !== text

  if (wasCompressed) {
    recordCompression(sessionID, originalLength, compressed.length)
  }

  return { compressed, wasCompressed }
}

export function isCavemanDeactivation(input: string): boolean {
  const lower = input.toLowerCase().trim()
  return (
    lower === "stop caveman" ||
    lower === "normal mode" ||
    lower === "/stop caveman" ||
    lower === "/normal mode"
  )
}

export function parseCavemanCommand(
  input: string
): { command: string; mode?: string } | null {
  const match = input.match(/^\/caveman(?:\s+(.+))?$/i)
  if (match) {
    return {
      command: "/caveman",
      mode: match[1]?.trim() || "full",
    }
  }

  if (input.match(/^\/caveman-commit\b/i)) {
    return { command: "/caveman-commit" }
  }

  if (input.match(/^\/caveman-review\b/i)) {
    return { command: "/caveman-review" }
  }

  if (input.match(/^\/caveman-help\b/i)) {
    return { command: "/caveman-help" }
  }

  return null
}

export function parseCavemanMode(input: string): CavemanMode {
  const normalized = input.toLowerCase().trim()

  if (normalized === "wenyan-full" || normalized === "wenyan") {
    return "wenyan-full"
  }

  switch (normalized) {
    case "lite":
      return "lite"
    case "full":
    case "default":
      return "full"
    case "ultra":
      return "ultra"
    case "wenyan-lite":
      return "wenyan-lite"
    case "wenyan":
    case "wenyan-full":
      return "wenyan-full"
    case "wenyan-ultra":
      return "wenyan-ultra"
    case "commit":
      return "commit"
    case "review":
      return "review"
    case "off":
    case "stop":
    case "normal":
      return "off"
    default:
      return "off"
  }
}

export function formatCavemanStatusLine(sessionID?: string): string {
  const status = getCavemanStatus()

  if (!status.active) {
    return ""
  }

  const stats = sessionID ? getCompressionStats(sessionID) : undefined
  const statsText = stats
    ? ` | ${stats.count} comps | ${stats.saved} chars saved`
    : ""

  return `${status.badge}${statsText}`
}
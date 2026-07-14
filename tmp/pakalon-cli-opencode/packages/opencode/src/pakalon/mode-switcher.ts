import { Log } from "../util/log"

const log = Log.create({ service: "pakalon:mode" })

export type PakalonMode = "plan" | "edit" | "auto-accept" | "bypass"

export interface ModeState {
  currentMode: PakalonMode
  thinkingEnabled: boolean
  sessionPath?: string
}

export namespace ModeSwitcher {
  const state = new Map<string, ModeState>()

  export function init(sessionId: string): ModeState {
    const s: ModeState = {
      currentMode: "plan",
      thinkingEnabled: false,
      sessionPath: sessionId,
    }
    state.set(sessionId, s)
    return s
  }

  export function get(sessionId: string): ModeState | undefined {
    return state.get(sessionId)
  }

  export function switchMode(sessionId: string, mode: PakalonMode): ModeState | null {
    const s = state.get(sessionId)
    if (!s) return null
    s.currentMode = mode
    state.set(sessionId, s)
    log.info("Mode switched", { sessionId, mode })
    return s
  }

  export function cycleMode(sessionId: string): ModeState | null {
    const s = state.get(sessionId)
    if (!s) return null

    const modes: PakalonMode[] = ["plan", "edit", "auto-accept", "bypass"]
    const currentIndex = modes.indexOf(s.currentMode)
    const nextIndex = (currentIndex + 1) % modes.length
    s.currentMode = modes[nextIndex]
    state.set(sessionId, s)
    log.info("Mode cycled", { sessionId, mode: s.currentMode })
    return s
  }

  export function toggleThinking(sessionId: string): ModeState | null {
    const s = state.get(sessionId)
    if (!s) return null
    s.thinkingEnabled = !s.thinkingEnabled
    state.set(sessionId, s)
    log.info("Thinking toggled", { sessionId, enabled: s.thinkingEnabled })
    return s
  }

  export function getModeDescription(mode: PakalonMode): string {
    switch (mode) {
      case "plan":
        return "Plan mode: Read-only, no code changes allowed"
      case "edit":
        return "Edit mode: File changes require permission"
      case "auto-accept":
        return "Auto-accept mode: All changes applied automatically"
      case "bypass":
        return "Bypass mode: Full automation, no interruptions"
    }
  }

  export function getModePermissions(mode: PakalonMode): {
    canRead: boolean
    canWrite: boolean
    canExecute: boolean
    requiresPermission: boolean
  } {
    switch (mode) {
      case "plan":
        return { canRead: true, canWrite: false, canExecute: false, requiresPermission: false }
      case "edit":
        return { canRead: true, canWrite: true, canExecute: true, requiresPermission: true }
      case "auto-accept":
        return { canRead: true, canWrite: true, canExecute: true, requiresPermission: false }
      case "bypass":
        return { canRead: true, canWrite: true, canExecute: true, requiresPermission: false }
    }
  }

  export function formatStatusBar(mode: PakalonMode, thinking: boolean): string {
    const modeIcon = {
      plan: "👁️",
      edit: "✏️",
      "auto-accept": "⚡",
      bypass: "🚀",
    }[mode]

    const thinkIcon = thinking ? "🧠" : ""
    return `${modeIcon} ${mode.toUpperCase()} ${thinkIcon}`.trim()
  }
}

export default ModeSwitcher

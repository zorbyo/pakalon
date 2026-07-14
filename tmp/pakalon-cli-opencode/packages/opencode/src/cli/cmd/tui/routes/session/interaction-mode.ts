import type { RGBA } from "@opentui/core"

export type InteractionMode = "plan" | "orchestration" | "auto-accept" | "build"

export const INTERACTION_MODE_LOOP: readonly InteractionMode[] = ["plan", "orchestration", "auto-accept", "build"]

type LocalAgentController = {
  agent: {
    list(): Array<{ name: string }>
    set(name: string): void
  }
}

type ModeTheme = {
  warning: RGBA
  info: RGBA
  error: RGBA
  success: RGBA
}

export function normalizeInteractionMode(value: string | undefined | null): InteractionMode {
  if (value === "plan" || value === "orchestration" || value === "auto-accept" || value === "build") return value
  return "build"
}

export function nextInteractionMode(value: string | undefined | null): InteractionMode {
  const current = normalizeInteractionMode(value)
  const index = INTERACTION_MODE_LOOP.indexOf(current)
  return INTERACTION_MODE_LOOP[(index + 1) % INTERACTION_MODE_LOOP.length] ?? "plan"
}

export function interactionModeColor(mode: string | undefined | null, theme: ModeTheme): RGBA {
  switch (normalizeInteractionMode(mode)) {
    case "plan":
      return theme.warning
    case "orchestration":
      return theme.info
    case "auto-accept":
      return theme.error
    case "build":
      return theme.success
  }
}

export function interactionModeLabel(mode: string | undefined | null) {
  switch (normalizeInteractionMode(mode)) {
    case "plan":
      return "PLAN"
    case "orchestration":
      return "ORCHESTRATION"
    case "auto-accept":
      return "AUTO ACCEPT"
    case "build":
      return "BUILD"
  }
}

export function applyInteractionMode(mode: string | undefined | null, local: LocalAgentController) {
  const available = new Set(local.agent.list().map((agent) => agent.name))
  const setFirstAvailable = (...names: string[]) => {
    for (const name of names) {
      if (!available.has(name)) continue
      local.agent.set(name)
      return true
    }
    return false
  }

  switch (normalizeInteractionMode(mode)) {
    case "plan":
      return setFirstAvailable("plan")
    case "orchestration":
      return setFirstAvailable("orchestration", "build", "general", "explore")
    case "auto-accept":
      return setFirstAvailable("auto-accept", "build", "general")
    case "build":
      return setFirstAvailable("build", "general")
  }
}

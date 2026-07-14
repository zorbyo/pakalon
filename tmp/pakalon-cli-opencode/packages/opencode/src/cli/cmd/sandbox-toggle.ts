import { cmd } from "./cmd"
import { UI } from "../ui"
import path from "path"
import { Filesystem } from "../../util/filesystem"
import { Global } from "../../global"

type SandboxMode = "off" | "read-only" | "workspace-write" | "danger-full-access"

interface SandboxToggleArgs {
  mode?: string
  json?: boolean
}

interface SandboxState {
  mode: SandboxMode
  updatedAt?: string
}

const DEFAULT_STATE: SandboxState = {
  mode: "off",
}

const STATE_FILE = path.join(Global.Path.state, "sandbox-toggle.json")

function normalizeMode(value?: string): SandboxMode | undefined {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized === "off") return "off"
  if (normalized === "read-only" || normalized === "read_only" || normalized === "readonly") return "read-only"
  if (
    normalized === "workspace-write" ||
    normalized === "workspace_write" ||
    normalized === "workspace"
  ) {
    return "workspace-write"
  }
  if (
    normalized === "danger-full-access" ||
    normalized === "danger_full_access" ||
    normalized === "danger"
  ) {
    return "danger-full-access"
  }
  return undefined
}

async function readState(): Promise<SandboxState> {
  const state = await Filesystem.readJson<SandboxState>(STATE_FILE).catch(() => undefined)
  if (!state || typeof state.mode !== "string") return DEFAULT_STATE

  const mode = normalizeMode(state.mode)
  if (!mode) return DEFAULT_STATE

  return {
    mode,
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : undefined,
  }
}

async function writeState(mode: SandboxMode): Promise<SandboxState> {
  const next: SandboxState = {
    mode,
    updatedAt: new Date().toISOString(),
  }
  await Filesystem.writeJson(STATE_FILE, next)
  return next
}

export const SandboxToggleCommand = cmd({
  command: "sandbox-toggle [mode]",
  describe: "show or set the global sandbox mode",
  builder: (yargs) =>
    yargs
      .positional("mode", {
        type: "string",
        choices: ["off", "read-only", "workspace-write", "danger-full-access"] as const,
        describe: "Sandbox mode",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output JSON",
      }),
  handler: async (rawArgs) => {
    const args: SandboxToggleArgs = {
      mode: typeof rawArgs.mode === "string" ? rawArgs.mode : undefined,
      json: Boolean(rawArgs.json),
    }

    const current = await readState()
    const currentMode = current.mode

    const normalized = normalizeMode(args.mode)
    let updated = false
    let nextMode: SandboxMode = currentMode

    if (normalized) {
      nextMode = normalized
      if (nextMode !== currentMode) {
        await writeState(nextMode)
        updated = true
      }
    }

    const payload = {
      updated,
      mode: nextMode,
      previousMode: currentMode,
      stateFile: STATE_FILE,
      acceptedModes: ["off", "read-only", "workspace-write", "danger-full-access"],
    }

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2))
      return
    }

    UI.println(UI.Style.TEXT_HIGHLIGHT + "Sandbox Mode" + UI.Style.TEXT_NORMAL)
    UI.empty()
    if (updated) {
      UI.println(
        UI.Style.TEXT_SUCCESS + `✓ Updated sandbox mode: ${currentMode} → ${nextMode}` + UI.Style.TEXT_NORMAL,
      )
    } else {
      UI.println(`Current sandbox mode: ${nextMode}`)
    }

    UI.empty()
    UI.println("Available modes:")
    for (const mode of payload.acceptedModes) {
      UI.println(`- ${mode}`)
    }
    UI.println(UI.Style.TEXT_DIM + `State file: ${payload.stateFile}` + UI.Style.TEXT_NORMAL)
  },
})

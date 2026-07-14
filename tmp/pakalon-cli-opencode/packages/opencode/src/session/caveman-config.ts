import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { Log } from "@/util/log"
import { Global } from "@/global"

export const CavemanLog = Log.create({ service: "caveman.config" })

export const CAVEMAN_VALID_MODES = [
  "off",
  "lite",
  "full",
  "ultra",
  "wenyan-lite",
  "wenyan",
  "wenyan-full",
  "wenyan-ultra",
  "commit",
  "review",
] as const

export type CavemanMode = (typeof CAVEMAN_VALID_MODES)[number]

export const CAVEMAN_VALID_INTENSITIES: CavemanMode[] = [...CAVEMAN_VALID_MODES]

export interface CavemanConfig {
  defaultMode: CavemanMode
  autoActivate: boolean
  showStatusline: boolean
  compressInput: boolean
  compressOutput: boolean
}

const CAVEMAN_CONFIG_DIR = ".pakalon/caveman"
const CAVEMAN_CONFIG_FILE = "config.json"

function getConfigDir(): string {
  const worktree = process.cwd()
  return path.join(worktree, CAVEMAN_CONFIG_DIR)
}

function getConfigPath(): string {
  return path.join(getConfigDir(), CAVEMAN_CONFIG_FILE)
}

export function getCavemanConfigDir(): string {
  return getConfigDir()
}

export function getCavemanConfigPath(): string {
  return getConfigPath()
}

export function getCavemanConfig(): CavemanConfig {
  const defaultConfig: CavemanConfig = {
    defaultMode: "off",
    autoActivate: false,
    showStatusline: true,
    compressInput: true,
    compressOutput: true,
  }

  if (process.env.PAKALON_CAVEMAN_MODE) {
    const envMode = process.env.PAKALON_CAVEMAN_MODE as CavemanMode
    if (CAVEMAN_VALID_MODES.includes(envMode)) {
      defaultConfig.defaultMode = envMode
      defaultConfig.autoActivate = process.env.PAKALON_CAVEMAN_AUTO !== "false"
      defaultConfig.showStatusline = process.env.PAKALON_CAVEMAN_STATUSLINE !== "false"
      defaultConfig.compressInput = process.env.PAKALON_CAVEMAN_COMPRESS_INPUT !== "false"
      defaultConfig.compressOutput = process.env.PAKALON_CAVEMAN_COMPRESS_OUTPUT !== "false"
      return defaultConfig
    }
  }

  try {
    const configPath = getConfigPath()
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, "utf8")
      const config = JSON.parse(content) as Partial<CavemanConfig>
      if (config.defaultMode && CAVEMAN_VALID_MODES.includes(config.defaultMode)) {
        return {
          defaultMode: config.defaultMode,
          autoActivate: config.autoActivate ?? defaultConfig.autoActivate,
          showStatusline: config.showStatusline ?? defaultConfig.showStatusline,
          compressInput: config.compressInput ?? defaultConfig.compressInput,
          compressOutput: config.compressOutput ?? defaultConfig.compressOutput,
        }
      }
    }
  } catch (e) {
    CavemanLog.warn("failed to load caveman config", { error: e })
  }

  return defaultConfig
}

export function setCavemanConfig(config: Partial<CavemanConfig>): void {
  const current = getCavemanConfig()
  const updated: CavemanConfig = {
    defaultMode: config.defaultMode ?? current.defaultMode,
    autoActivate: config.autoActivate ?? current.autoActivate,
    showStatusline: config.showStatusline ?? current.showStatusline,
    compressInput: config.compressInput ?? current.compressInput,
    compressOutput: config.compressOutput ?? current.compressOutput,
  }

  const configDir = getConfigDir()
  const configPath = getConfigPath()

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  fs.writeFileSync(configPath, JSON.stringify(updated, null, 2))
  CavemanLog.info("caveman config saved", { config: updated })
}

export function setCavemanMode(mode: CavemanMode): void {
  setCavemanConfig({ defaultMode: mode })
}

export function getCavemanMode(): CavemanMode {
  return getCavemanConfig().defaultMode
}

export function isCavemanActive(): boolean {
  const mode = getCavemanMode()
  return mode !== "off"
}

export function isCavemanMode(mode: string): mode is CavemanMode {
  return CAVEMAN_VALID_MODES.includes(mode as CavemanMode)
}

export function getCavemanModeFromString(input: string): CavemanMode {
  const normalized = input.toLowerCase().trim()

  if (normalized === "wenyan-full" || normalized === "wenyan") {
    return "wenyan-full"
  }

  if (isCavemanMode(normalized)) {
    return normalized
  }

  if (normalized === "default" || normalized === "full") {
    return "full"
  }

  return "off"
}

export function getModeDisplayName(mode: CavemanMode): string {
  switch (mode) {
    case "off":
      return "OFF"
    case "lite":
      return "LITE"
    case "full":
      return "CAVEMAN"
    case "ultra":
      return "ULTRA"
    case "wenyan-lite":
      return "WENYAN-LITE"
    case "wenyan":
    case "wenyan-full":
      return "WENYAN"
    case "wenyan-ultra":
      return "WENYAN-ULTRA"
    case "commit":
      return "COMMIT"
    case "review":
      return "REVIEW"
    default:
      return mode.toUpperCase()
  }
}

export function getModeColor(mode: CavemanMode): string {
  switch (mode) {
    case "off":
      return ""
    case "lite":
      return "\x1b[33m"
    case "full":
      return "\x1b[35m"
    case "ultra":
      return "\x1b[31m"
    case "wenyan-lite":
    case "wenyan":
    case "wenyan-full":
    case "wenyan-ultra":
      return "\x1b[36m"
    case "commit":
      return "\x1b[32m"
    case "review":
      return "\x1b[34m"
    default:
      return "\x1b[33m"
  }
}

export function formatModeBadge(mode: CavemanMode): string {
  const reset = "\x1b[0m"
  const color = getModeColor(mode)
  const name = getModeDisplayName(mode)

  if (mode === "off") {
    return ""
  }

  if (mode === "full" || mode === "off") {
    return `${color}[${name}]${reset}`
  }

  return `${color}[${name}]${reset}`
}
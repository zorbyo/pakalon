import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface GlobalConfig {
  voiceLangHintShownCount?: number
  voiceLangHintLastLanguage?: string
  voiceNoticeSeenCount?: number
  [key: string]: unknown
}

function getConfigPath(): string {
  const configDir = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config')
  return path.join(configDir, 'pakalon', 'global_config.json')
}

let cachedConfig: GlobalConfig | null = null

function readConfig(): GlobalConfig {
  if (cachedConfig) return cachedConfig
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8')
    cachedConfig = JSON.parse(raw) as GlobalConfig
    return cachedConfig
  } catch {
    cachedConfig = {}
    return cachedConfig
  }
}

export function getGlobalConfig(): GlobalConfig {
  return readConfig()
}

export function saveGlobalConfig(
  updater: (prev: GlobalConfig) => GlobalConfig,
): void {
  const current = readConfig()
  const next = updater(current)
  const configPath = getConfigPath()
  const dir = path.dirname(configPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2), 'utf-8')
  cachedConfig = next
}

export function clearGlobalConfigCache(): void {
  cachedConfig = null
}

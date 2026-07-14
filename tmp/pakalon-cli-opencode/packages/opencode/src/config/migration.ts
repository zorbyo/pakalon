import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { existsSync } from "fs"

const log = Log.create({ service: "config-migration" })

// Map of deprecated camelCase keys to their snake_case equivalents
const KEY_MIGRATIONS: Record<string, string> = {
  // Config top-level
  logLevel: "log_level",
  smallModel: "small_model",
  defaultAgent: "default_agent",
  disabledProviders: "disabled_providers",
  enabledProviders: "enabled_providers",

  // MCP config
  clientId: "client_id",
  clientSecret: "client_secret",

  // Agent config
  maxSteps: "max_steps",
  topP: "top_p",

  // Provider config
  apiKey: "api_key",
  baseUrl: "base_url",
  enterpriseUrl: "enterprise_url",
  setCacheKey: "set_cache_key",
  chunkTimeout: "chunk_timeout",

  // Server config
  mdnsDomain: "mdns_domain",

  // Keybind config (all keys are already snake_case)

  // Experimental config
  disable_paste_summary: "disable_paste_summary",
  batch_tool: "batch_tool",
  openTelemetry: "open_telemetry",
  primary_tools: "primary_tools",
  continue_loop_on_deny: "continue_loop_on_deny",
  mcp_timeout: "mcp_timeout",
}

export namespace ConfigMigration {
  export function migrateKeys(obj: unknown, path = ""): { migrated: boolean; result: unknown } {
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
      return { migrated: false, result: obj }
    }

    const result: Record<string, unknown> = {}
    let migrated = false

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const currentPath = path ? `${path}.${key}` : key
      const newKey = KEY_MIGRATIONS[key]

      if (newKey) {
        log.info("migrating config key", { from: currentPath, to: `${path ? `${path}.` : ""}${newKey}` })
        result[newKey] = value
        migrated = true
      } else {
        result[key] = value
      }

      // Recursively migrate nested objects
      if (typeof value === "object" && value !== null) {
        const nested = migrateKeys(value, currentPath)
        if (nested.migrated) {
          result[newKey ?? key] = nested.result
          migrated = true
        }
      }
    }

    return { migrated, result }
  }

  export async function migrateConfigFile(filepath: string): Promise<boolean> {
    if (!existsSync(filepath)) return false

    try {
      const content = await Filesystem.readText(filepath)
      const parsed = JSON.parse(content)
      const { migrated, result } = migrateKeys(parsed)

      if (migrated) {
        await Filesystem.writeJson(filepath, result)
        log.info("migrated config file", { path: filepath })
      }

      return migrated
    } catch (error) {
      log.warn("failed to migrate config file", { path: filepath, error })
      return false
    }
  }
}

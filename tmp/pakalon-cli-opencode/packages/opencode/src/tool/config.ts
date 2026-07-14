import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./config.txt"
import { Log } from "../util/log"
import { Config } from "../config/config"

export const log = Log.create({ service: "config-tool" })

// Supported settings and their configurations
interface SettingConfig {
  type: "string" | "boolean" | "number"
  path: string[]
  options?: string[]
  source: "global" | "project"
}

const SUPPORTED_SETTINGS: Record<string, SettingConfig> = {
  "theme": {
    type: "string",
    path: ["theme"],
    options: ["dark", "light", "auto"],
    source: "global",
  },
  "model": {
    type: "string",
    path: ["model"],
    source: "global",
  },
  "permissions.defaultMode": {
    type: "string",
    path: ["permissions", "defaultMode"],
    options: ["ask", "auto-approve", "deny"],
    source: "global",
  },
  "experimental.batch_tool": {
    type: "boolean",
    path: ["experimental", "batch_tool"],
    source: "project",
  },
  "auto_compact": {
    type: "boolean",
    path: ["auto_compact"],
    source: "global",
  },
  "verbose": {
    type: "boolean",
    path: ["verbose"],
    source: "global",
  },
}

/**
 * Get value from nested object using path
 */
function getValueAtPath(obj: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = obj
  for (const key of path) {
    if (current && typeof current === "object" && key in current) {
      current = (current as Record<string, unknown>)[key]
    } else {
      return undefined
    }
  }
  return current
}

/**
 * Set value in nested object using path
 */
function setValueAtPath(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let current = obj
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]
    if (!(key in current) || typeof current[key] !== "object") {
      current[key] = {}
    }
    current = current[key] as Record<string, unknown>
  }
  const lastKey = path[path.length - 1]
  current[lastKey] = value
}

export const ConfigTool = Tool.define("config", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      setting: z
        .string()
        .describe(
          'The setting key (e.g., "theme", "model", "permissions.defaultMode")',
        ),
      value: z
        .union([z.string(), z.boolean(), z.number()])
        .optional()
        .describe("The new value. Omit to get current value."),
    }),
    async execute(params, ctx) {
      const { setting, value } = params

      // Check if setting is supported
      const config = SUPPORTED_SETTINGS[setting]
      if (!config) {
        const supportedKeys = Object.keys(SUPPORTED_SETTINGS).join(", ")
        return {
          title: "Config Error",
          metadata: {
            success: false,
            error: `Unknown setting: "${setting}". Supported settings: ${supportedKeys}`,
          },
          output: JSON.stringify({
            success: false,
            error: `Unknown setting: "${setting}". Supported settings: ${supportedKeys}`,
          }),
        }
      }

      // GET operation
      if (value === undefined) {
        try {
          const currentConfig = await Config.get()
          const currentValue = getValueAtPath(currentConfig as Record<string, unknown>, config.path)

          log.info("config get", { setting, value: currentValue })

          return {
            title: `Get ${setting}`,
            metadata: {
              success: true,
              operation: "get",
              setting,
              value: currentValue,
            },
            output: JSON.stringify({
              success: true,
              operation: "get",
              setting,
              value: currentValue,
            }),
          }
        } catch (error) {
          return {
            title: "Config Error",
            metadata: {
              success: false,
              error: String(error),
            },
            output: JSON.stringify({
              success: false,
              error: String(error),
            }),
          }
        }
      }

      // SET operation - validate value
      let finalValue: unknown = value

      // Coerce and validate boolean values
      if (config.type === "boolean") {
        if (typeof value === "string") {
          const lower = value.toLowerCase().trim()
          if (lower === "true") finalValue = true
          else if (lower === "false") finalValue = false
        }
        if (typeof finalValue !== "boolean") {
          return {
            title: "Config Error",
            metadata: {
              success: false,
              operation: "set",
              setting,
              error: `${setting} requires true or false.`,
            },
            output: JSON.stringify({
              success: false,
              operation: "set",
              setting,
              error: `${setting} requires true or false.`,
            }),
          }
        }
      }

      // Check options if defined
      if (config.options && !config.options.includes(String(finalValue))) {
        return {
          title: "Config Error",
          metadata: {
            success: false,
            operation: "set",
            setting,
            error: `Invalid value "${value}". Options: ${config.options.join(", ")}`,
          },
          output: JSON.stringify({
            success: false,
            operation: "set",
            setting,
            error: `Invalid value "${value}". Options: ${config.options.join(", ")}`,
          }),
        }
      }

      // Request permission for set operation
      await ctx.ask({
        permission: "config",
        patterns: [`${setting} = ${JSON.stringify(finalValue)}`],
        always: [`${setting} = *`],
        metadata: {},
      })

      try {
        const currentConfig = await Config.get()
        const previousValue = getValueAtPath(currentConfig as Record<string, unknown>, config.path)

        // Update config
        await Config.set(setting, finalValue)

        log.info("config set", { setting, previousValue, newValue: finalValue })

        return {
          title: `Set ${setting}`,
          metadata: {
            success: true,
            operation: "set",
            setting,
            previousValue,
            newValue: finalValue,
          },
          output: JSON.stringify({
            success: true,
            operation: "set",
            setting,
            previousValue,
            newValue: finalValue,
          }),
        }
      } catch (error) {
        return {
          title: "Config Error",
          metadata: {
            success: false,
            operation: "set",
            setting,
            error: String(error),
          },
          output: JSON.stringify({
            success: false,
            operation: "set",
            setting,
            error: String(error),
          }),
        }
      }
    },
  }
})

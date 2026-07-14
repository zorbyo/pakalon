import { cmd } from "./cmd"
import { Instance } from "@/project/instance"
import { UI } from "../ui"
import { Config } from "@/config/config"

interface ConfigArgs {
  key?: string
  value?: string
  list?: boolean
}

export const ConfigCommand = cmd({
  command: "config [key] [value]",
  describe: "View or modify configuration settings",
  builder: (yargs) =>
    yargs
      .positional("key", {
        type: "string",
        describe: "Configuration key to get or set",
      })
      .positional("value", {
        type: "string",
        describe: "Value to set (omit to get current value)",
      })
      .option("list", {
        type: "boolean",
        alias: "l",
        describe: "List all configuration values",
      }),
  async handler(args: ConfigArgs) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        // List all config
        if (args.list || (!args.key && !args.value)) {
          UI.println(UI.Style.TEXT_HIGHLIGHT + "Configuration Settings")
          UI.empty()

          try {
            const config = await Config.get()
            
            // Display configuration as a formatted list
            const entries = Object.entries(config).filter(([_, v]) => v !== undefined)
            
            for (const [key, value] of entries) {
              if (typeof value === "object" && value !== null) {
                UI.println(`${UI.Style.TEXT_INFO}${key}:${UI.Style.RESET}`)
                for (const [subKey, subValue] of Object.entries(value)) {
                  UI.println(`  ${subKey}: ${formatValue(subValue)}`)
                }
              } else {
                UI.println(`${UI.Style.TEXT_INFO}${key}:${UI.Style.RESET} ${formatValue(value)}`)
              }
            }

            if (entries.length === 0) {
              UI.println(UI.Style.TEXT_DIM + "No configuration set.")
            }

          } catch (error) {
            UI.println(UI.Style.TEXT_ERROR + `Failed to read config: ${error}`)
          }
          return
        }

        // Get specific key
        if (args.key && !args.value) {
          try {
            const config = await Config.get()
            const keys = args.key.split(".")
            let value: unknown = config

            for (const k of keys) {
              if (value && typeof value === "object" && k in value) {
                value = (value as Record<string, unknown>)[k]
              } else {
                UI.println(UI.Style.TEXT_WARN + `Key not found: ${args.key}`)
                return
              }
            }

            UI.println(`${args.key}: ${formatValue(value)}`)

          } catch (error) {
            UI.println(UI.Style.TEXT_ERROR + `Failed to read config: ${error}`)
          }
          return
        }

        // Set value
        if (args.key && args.value) {
          try {
            // Parse value (handle booleans, numbers)
            let parsedValue: unknown = args.value

            if (args.value === "true") parsedValue = true
            else if (args.value === "false") parsedValue = false
            else if (!isNaN(Number(args.value))) parsedValue = Number(args.value)

            await Config.set(args.key, parsedValue)

            UI.println(UI.Style.TEXT_SUCCESS + `✓ Set ${args.key} = ${formatValue(parsedValue)}`)

          } catch (error) {
            UI.println(UI.Style.TEXT_ERROR + `Failed to set config: ${error}`)
          }
        }
      },
    })
  },
})

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return UI.Style.TEXT_DIM + "(not set)" + UI.Style.RESET
  }
  if (typeof value === "boolean") {
    return value ? UI.Style.TEXT_SUCCESS + "true" + UI.Style.RESET : UI.Style.TEXT_ERROR + "false" + UI.Style.RESET
  }
  if (typeof value === "number") {
    return UI.Style.TEXT_INFO + String(value) + UI.Style.RESET
  }
  if (typeof value === "string") {
    return `"${value}"`
  }
  if (Array.isArray(value)) {
    return `[${value.map(formatValue).join(", ")}]`
  }
  if (typeof value === "object") {
    return JSON.stringify(value)
  }
  return String(value)
}

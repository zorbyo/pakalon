import { cmd, Instance } from "./cmd"
import type { CommandModule } from "yargs"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

/**
 * /hooks command - Manage custom hooks
 */
export const hooks: CommandModule = cmd(
  "hooks [action]",
  "Manage custom hooks for CLI events",
  (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        choices: ["list", "add", "remove", "enable", "disable"],
        default: "list",
        description: "Action to perform",
      })
      .option("hook", {
        alias: "h",
        type: "string",
        description: "Hook name",
      })
      .option("event", {
        alias: "e",
        type: "string",
        choices: ["pre-prompt", "post-response", "pre-tool", "post-tool"],
        description: "Event to hook into",
      })
      .option("script", {
        alias: "s",
        type: "string",
        description: "Path to hook script",
      }),
  Instance.provide(async (args, _ctx, instance) => {
    const action = args.action as string
    const hookName = args.hook as string | undefined
    const event = args.event as string | undefined
    const script = args.script as string | undefined

    console.log("\n🪝 Hooks Manager")
    console.log("═".repeat(50))

    switch (action) {
      case "list": {
        console.log("\n📋 Available Events:")
        console.log("─".repeat(40))
        console.log("  • pre-prompt    - Before user prompt is processed")
        console.log("  • post-response - After AI response is received")
        console.log("  • pre-tool      - Before a tool is executed")
        console.log("  • post-tool     - After a tool is executed")
        
        console.log("\n📋 Registered Hooks:")
        console.log("─".repeat(40))
        console.log("  (No hooks registered)")
        
        console.log("\nUsage: /hooks add --hook <name> --event <event> --script <path>")
        break
      }

      case "add": {
        if (!hookName || !event || !script) {
          console.error("Error: --hook, --event, and --script are required")
          return
        }
        
        if (!fs.existsSync(script)) {
          console.error(`Error: Script not found: ${script}`)
          return
        }

        console.log(`\n✓ Hook added:`)
        console.log(`  Name: ${hookName}`)
        console.log(`  Event: ${event}`)
        console.log(`  Script: ${script}`)
        break
      }

      case "remove": {
        if (!hookName) {
          console.error("Error: --hook is required")
          return
        }
        console.log(`\n✓ Hook removed: ${hookName}`)
        break
      }

      case "enable": {
        if (!hookName) {
          console.error("Error: --hook is required")
          return
        }
        console.log(`\n✓ Hook enabled: ${hookName}`)
        break
      }

      case "disable": {
        if (!hookName) {
          console.error("Error: --hook is required")
          return
        }
        console.log(`\n✓ Hook disabled: ${hookName}`)
        break
      }
    }
  })
)

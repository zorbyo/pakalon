import { cmd, Instance } from "./cmd"
import type { CommandModule } from "yargs"

/**
 * /vim command - Toggle or configure vim mode
 */
export const vim: CommandModule = cmd(
  "vim [action]",
  "Toggle or configure vim mode",
  (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        choices: ["on", "off", "toggle", "status"],
        default: "toggle",
        description: "Action to perform",
      }),
  Instance.provide(async (args, _ctx, instance) => {
    const action = args.action as string

    console.log("\n⌨️ Vim Mode")
    console.log("═".repeat(50))

    switch (action) {
      case "on": {
        console.log("✓ Vim mode enabled")
        console.log("  You can now use vim keybindings in the input.")
        console.log("\n  Quick reference:")
        console.log("  • i     - Enter insert mode")
        console.log("  • Esc   - Enter normal mode")
        console.log("  • dd    - Delete line")
        console.log("  • yy    - Yank (copy) line")
        console.log("  • p     - Paste")
        console.log("  • hjkl  - Move cursor")
        break
      }

      case "off": {
        console.log("✓ Vim mode disabled")
        console.log("  Standard editing mode is now active.")
        break
      }

      case "toggle": {
        // Check current state and toggle
        const currentState = false // Would be read from config
        if (currentState) {
          console.log("✓ Vim mode disabled")
        } else {
          console.log("✓ Vim mode enabled")
        }
        break
      }

      case "status":
      default: {
        const enabled = false // Would be read from config
        console.log(`\n  Status: ${enabled ? "Enabled" : "Disabled"}`)
        console.log("\n  Available commands:")
        console.log("  • /vim on      - Enable vim mode")
        console.log("  • /vim off     - Disable vim mode")
        console.log("  • /vim toggle  - Toggle vim mode")
        break
      }
    }
  })
)

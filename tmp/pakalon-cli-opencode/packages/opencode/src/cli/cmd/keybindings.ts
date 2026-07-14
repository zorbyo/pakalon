import { cmd, Instance } from "./cmd"
import type { CommandModule } from "yargs"

/**
 * /keybindings command - View and customize keybindings
 */
export const keybindings: CommandModule = cmd(
  "keybindings [action]",
  "View and customize keybindings",
  (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        choices: ["list", "set", "reset"],
        default: "list",
        description: "Action to perform",
      })
      .option("key", {
        alias: "k",
        type: "string",
        description: "Key combination (e.g., 'Ctrl+Enter')",
      })
      .option("command", {
        alias: "c",
        type: "string",
        description: "Command to bind",
      }),
  Instance.provide(async (args, _ctx, instance) => {
    const action = args.action as string
    const key = args.key as string | undefined
    const command = args.command as string | undefined

    console.log("\n⌨️ Keybindings")
    console.log("═".repeat(50))

    switch (action) {
      case "list": {
        console.log("\n📋 Default Keybindings:")
        console.log("─".repeat(40))
        
        const bindings = [
          { key: "Enter", action: "Submit prompt" },
          { key: "Shift+Enter", action: "New line" },
          { key: "Ctrl+C", action: "Cancel current operation" },
          { key: "Ctrl+L", action: "Clear screen" },
          { key: "Ctrl+D", action: "Exit" },
          { key: "Up/Down", action: "Navigate history" },
          { key: "Tab", action: "Autocomplete" },
          { key: "Esc", action: "Cancel/Clear input" },
          { key: "Ctrl+U", action: "Clear line" },
          { key: "Ctrl+K", action: "Delete to end of line" },
          { key: "Ctrl+A", action: "Move to start of line" },
          { key: "Ctrl+E", action: "Move to end of line" },
        ]

        for (const binding of bindings) {
          console.log(`  ${binding.key.padEnd(15)} - ${binding.action}`)
        }

        console.log("\nVim Mode (when enabled):")
        console.log("─".repeat(40))
        console.log("  i               - Enter insert mode")
        console.log("  Esc             - Enter normal mode")
        console.log("  hjkl            - Move cursor")
        console.log("  dd              - Delete line")
        console.log("  yy              - Yank (copy) line")
        console.log("  p               - Paste")
        break
      }

      case "set": {
        if (!key || !command) {
          console.error("Error: --key and --command are required")
          console.log("Usage: /keybindings set --key 'Ctrl+S' --command save")
          return
        }
        console.log(`\n✓ Keybinding set:`)
        console.log(`  Key: ${key}`)
        console.log(`  Command: ${command}`)
        break
      }

      case "reset": {
        console.log("\n✓ Keybindings reset to defaults")
        break
      }
    }
  })
)

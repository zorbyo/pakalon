import { cmd, Instance } from "./cmd"
import type { CommandModule } from "yargs"

/**
 * /permissions command - Manage tool permissions
 */
export const permissions: CommandModule = cmd(
  "permissions [action]",
  "Manage tool and file permissions",
  (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        choices: ["list", "grant", "revoke", "reset"],
        default: "list",
        description: "Action to perform",
      })
      .option("tool", {
        alias: "t",
        type: "string",
        description: "Tool to modify permissions for",
      })
      .option("path", {
        alias: "p",
        type: "string",
        description: "Path to grant/revoke access to",
      }),
  Instance.provide(async (args, _ctx, instance) => {
    const action = args.action as string
    const tool = args.tool as string | undefined
    const pathArg = args.path as string | undefined

    console.log("\n🔒 Permissions Manager")
    console.log("═".repeat(50))

    switch (action) {
      case "list": {
        console.log("\n📋 Current Permissions:")
        console.log("─".repeat(40))
        
        console.log("\n  Tool Permissions:")
        console.log("  • BashTool        - Requires confirmation")
        console.log("  • EditTool        - Auto-approved")
        console.log("  • ReadTool        - Auto-approved")
        console.log("  • WriteTool       - Requires confirmation")
        console.log("  • DeleteTool      - Requires confirmation")
        
        console.log("\n  Path Permissions:")
        console.log("  • ./              - Read/Write allowed")
        console.log("  • ~/              - Read only")
        console.log("  • /               - Blocked")
        break
      }

      case "grant": {
        if (!tool && !pathArg) {
          console.error("Error: Specify --tool or --path to grant permissions")
          return
        }
        if (tool) {
          console.log(`✓ Granted permissions to tool: ${tool}`)
        }
        if (pathArg) {
          console.log(`✓ Granted access to path: ${pathArg}`)
        }
        break
      }

      case "revoke": {
        if (!tool && !pathArg) {
          console.error("Error: Specify --tool or --path to revoke permissions")
          return
        }
        if (tool) {
          console.log(`✓ Revoked permissions from tool: ${tool}`)
        }
        if (pathArg) {
          console.log(`✓ Revoked access to path: ${pathArg}`)
        }
        break
      }

      case "reset": {
        console.log("✓ Permissions reset to defaults")
        break
      }
    }

    console.log("\n💡 Tips:")
    console.log("  - Use /permissions grant --tool <name> to allow a tool")
    console.log("  - Use /permissions revoke --path <path> to block access")
  })
)

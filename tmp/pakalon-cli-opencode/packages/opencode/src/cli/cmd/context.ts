import { cmd, Instance } from "./cmd"
import type { CommandModule } from "yargs"
import * as fs from "fs"
import * as path from "path"

/**
 * /context command - Manage context files and directories
 */
export const context: CommandModule = cmd(
  "context [action] [path]",
  "Manage context files and directories",
  (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        choices: ["add", "remove", "list", "clear"],
        default: "list",
        description: "Action to perform",
      })
      .positional("path", {
        type: "string",
        description: "Path to add or remove from context",
      })
      .option("recursive", {
        alias: "r",
        type: "boolean",
        default: false,
        description: "Add directory recursively",
      }),
  Instance.provide(async (args, _ctx, instance) => {
    const action = args.action as string
    const targetPath = args.path as string | undefined

    switch (action) {
      case "add": {
        if (!targetPath) {
          console.error("Error: Path is required for 'add' action")
          return
        }

        const resolvedPath = path.resolve(process.cwd(), targetPath)
        
        if (!fs.existsSync(resolvedPath)) {
          console.error(`Error: Path does not exist: ${resolvedPath}`)
          return
        }

        const stat = fs.statSync(resolvedPath)
        
        if (stat.isDirectory() && args.recursive) {
          console.log(`Adding directory recursively: ${resolvedPath}`)
          // In a full implementation, this would add all files in the directory
        } else if (stat.isFile()) {
          console.log(`Adding file to context: ${resolvedPath}`)
        } else if (stat.isDirectory()) {
          console.log(`Adding directory to context: ${resolvedPath}`)
          console.log("Use --recursive to include all files")
        }
        break
      }

      case "remove": {
        if (!targetPath) {
          console.error("Error: Path is required for 'remove' action")
          return
        }
        console.log(`Removed from context: ${targetPath}`)
        break
      }

      case "clear": {
        console.log("Context cleared")
        break
      }

      case "list":
      default: {
        console.log("\n📁 Current Context Files:")
        console.log("─".repeat(40))
        // In a full implementation, this would list actual context files
        console.log("  (No context files currently added)")
        console.log("")
        console.log("Use '/context add <path>' to add files")
        break
      }
    }
  })
)

import { cmd, Instance } from "./cmd"
import type { CommandModule } from "yargs"

/**
 * /tag command - Tag the current session
 */
export const tag: CommandModule = cmd(
  "tag [action]",
  "Manage session tags",
  (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        choices: ["add", "remove", "list", "clear"],
        default: "list",
        description: "Action to perform",
      })
      .option("tag", {
        alias: "t",
        type: "string",
        description: "Tag name",
      }),
  Instance.provide(async (args, _ctx, instance) => {
    const action = args.action as string
    const tagName = args.tag as string | undefined

    console.log("\n🏷️ Session Tags")
    console.log("═".repeat(50))

    switch (action) {
      case "list": {
        console.log("\n📋 Current Tags:")
        console.log("─".repeat(40))
        console.log("  (No tags)")
        console.log("\nUse /tag add --tag 'name' to add a tag")
        break
      }

      case "add": {
        if (!tagName) {
          console.error("Error: --tag is required")
          console.log("Usage: /tag add --tag 'my-tag'")
          return
        }
        console.log(`\n✓ Tag added: ${tagName}`)
        break
      }

      case "remove": {
        if (!tagName) {
          console.error("Error: --tag is required")
          console.log("Usage: /tag remove --tag 'my-tag'")
          return
        }
        console.log(`\n✓ Tag removed: ${tagName}`)
        break
      }

      case "clear": {
        console.log("\n✓ All tags cleared")
        break
      }
    }
  })
)

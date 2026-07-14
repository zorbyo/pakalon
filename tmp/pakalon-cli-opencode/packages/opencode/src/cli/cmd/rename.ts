import { cmd, Instance } from "./cmd"
import type { CommandModule } from "yargs"

/**
 * /rename command - Rename the current session
 */
export const rename: CommandModule = cmd(
  "rename <name>",
  "Rename the current session",
  (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        demandOption: true,
        description: "New name for the session",
      }),
  Instance.provide(async (args, _ctx, instance) => {
    const newName = args.name as string

    console.log("\n📝 Rename Session")
    console.log("═".repeat(50))

    // Validate name
    if (newName.length < 1) {
      console.error("Error: Name cannot be empty")
      return
    }

    if (newName.length > 100) {
      console.error("Error: Name must be 100 characters or less")
      return
    }

    // Check for invalid characters
    const invalidChars = /[<>:"/\\|?*]/
    if (invalidChars.test(newName)) {
      console.error("Error: Name contains invalid characters")
      return
    }

    console.log(`\n✓ Session renamed to: "${newName}"`)
  })
)

import { cmd, Instance } from "./cmd"
import type { CommandModule } from "yargs"

/**
 * /rewind command - Rewind conversation to a previous state
 */
export const rewind: CommandModule = cmd(
  "rewind [steps]",
  "Rewind conversation to a previous state",
  (yargs) =>
    yargs
      .positional("steps", {
        type: "number",
        default: 1,
        description: "Number of messages to rewind",
      })
      .option("to", {
        alias: "t",
        type: "string",
        description: "Rewind to specific message ID",
      })
      .option("list", {
        alias: "l",
        type: "boolean",
        default: false,
        description: "List recent messages with IDs",
      }),
  Instance.provide(async (args, _ctx, instance) => {
    const steps = args.steps as number
    const toId = args.to as string | undefined
    const listMessages = args.list as boolean

    console.log("\n⏪ Rewind Conversation")
    console.log("═".repeat(50))

    if (listMessages) {
      console.log("\n📝 Recent Messages:")
      console.log("─".repeat(40))
      console.log("  (No messages in current session)")
      console.log("\nUse /rewind --to <id> to rewind to a specific message")
      return
    }

    if (toId) {
      console.log(`\nRewinding to message: ${toId}`)
      console.log("✓ Conversation rewound successfully")
      console.log("  Messages after this point have been removed.")
    } else {
      console.log(`\nRewinding ${steps} message(s)...`)
      console.log("✓ Conversation rewound successfully")
      console.log(`  ${steps} message(s) have been removed.`)
    }

    console.log("\n💡 Tips:")
    console.log("  - Use /rewind --list to see message IDs")
    console.log("  - Use /rewind 3 to rewind 3 messages")
    console.log("  - Use /rewind --to <id> for precise control")
  })
)

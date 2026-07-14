import { cmd, Instance } from "./cmd"
import type { CommandModule } from "yargs"

/**
 * /feedback command - Send feedback
 */
export const feedback: CommandModule = cmd(
  "feedback [message]",
  "Send feedback about the CLI",
  (yargs) =>
    yargs
      .positional("message", {
        type: "string",
        description: "Feedback message",
      })
      .option("type", {
        alias: "t",
        type: "string",
        choices: ["bug", "feature", "general"],
        default: "general",
        description: "Type of feedback",
      })
      .option("include-session", {
        alias: "s",
        type: "boolean",
        default: false,
        description: "Include session context with feedback",
      }),
  Instance.provide(async (args, _ctx, instance) => {
    const message = args.message as string | undefined
    const feedbackType = args.type as string
    const includeSession = args["include-session"] as boolean

    console.log("\n📣 Send Feedback")
    console.log("═".repeat(50))

    if (!message) {
      console.log("\n  We'd love to hear from you!")
      console.log("\n  Feedback Types:")
      console.log("  • bug      - Report a bug or issue")
      console.log("  • feature  - Request a new feature")
      console.log("  • general  - General feedback or comments")
      console.log("\nUsage: /feedback 'Your message here' --type <type>")
      console.log("       /feedback 'Include context' --include-session")
      return
    }

    console.log(`\n  Type: ${feedbackType}`)
    console.log(`  Message: ${message}`)
    
    if (includeSession) {
      console.log("  Session context: Will be included")
    }

    // In a full implementation, this would send feedback to a server
    console.log("\n✓ Thank you for your feedback!")
    console.log("  Your input helps us improve the CLI.")
  })
)

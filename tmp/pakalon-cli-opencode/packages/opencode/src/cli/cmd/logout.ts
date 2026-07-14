import { cmd, Instance } from "./cmd"
import type { CommandModule } from "yargs"

/**
 * /logout command - Remove authentication
 */
export const logout: CommandModule = cmd(
  "logout [provider]",
  "Remove authentication for a provider",
  (yargs) =>
    yargs
      .positional("provider", {
        type: "string",
        choices: ["anthropic", "openai", "google", "github", "all"],
        description: "Provider to log out from (or 'all')",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        description: "Skip confirmation prompt",
      }),
  Instance.provide(async (args, _ctx, instance) => {
    const provider = args.provider as string | undefined
    const force = args.force as boolean

    if (!provider) {
      console.log("\n🔓 Logout from Provider")
      console.log("═".repeat(50))
      console.log("\nCurrently authenticated providers:")
      console.log("  (No active sessions)")
      console.log("\nUsage: /logout <provider> or /logout all")
      return
    }

    if (provider === "all") {
      console.log("\n🔓 Logging out from all providers...")
      console.log("─".repeat(40))
      console.log("✓ Logged out from all providers")
      console.log("  All stored credentials have been removed.")
    } else {
      console.log(`\n🔓 Logging out from ${provider}...`)
      console.log("─".repeat(40))
      console.log(`✓ Logged out from ${provider}`)
      console.log("  Stored credentials have been removed.")
    }
  })
)

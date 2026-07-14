import { cmd, Instance } from "./cmd"
import type { CommandModule } from "yargs"

/**
 * /onboarding command - Start onboarding wizard
 */
export const onboarding: CommandModule = cmd(
  "onboarding",
  "Start the onboarding wizard",
  (yargs) =>
    yargs
      .option("reset", {
        alias: "r",
        type: "boolean",
        default: false,
        description: "Reset onboarding state and start fresh",
      }),
  Instance.provide(async (args, _ctx, instance) => {
    const reset = args.reset as boolean

    console.log("\n🚀 Welcome to Pakalon CLI!")
    console.log("═".repeat(50))

    if (reset) {
      console.log("\n  Resetting onboarding state...")
      console.log("  ✓ Onboarding reset")
    }

    console.log("\n  Let's get you started with the CLI.\n")
    
    console.log("  1️⃣  Authentication")
    console.log("     Set up your API keys or log in with OAuth.")
    console.log("     Use: /login <provider>")
    
    console.log("\n  2️⃣  Configuration")
    console.log("     Customize your experience with settings.")
    console.log("     Use: /config")
    
    console.log("\n  3️⃣  Basic Commands")
    console.log("     Learn the most useful commands.")
    console.log("     Use: /help")
    
    console.log("\n  4️⃣  Start Coding!")
    console.log("     Just type your request and press Enter.")
    
    console.log("\n─".repeat(40))
    console.log("\n  Quick Start Commands:")
    console.log("  • /help           - Show all commands")
    console.log("  • /login          - Set up authentication")
    console.log("  • /model          - Choose your AI model")
    console.log("  • /config         - View/edit settings")
    
    console.log("\n  Need help? Type '/help <command>' for details.")
  })
)

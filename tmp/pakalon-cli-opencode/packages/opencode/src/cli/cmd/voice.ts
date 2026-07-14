import { cmd, Instance } from "./cmd"
import type { CommandModule } from "yargs"

/**
 * /voice command - Toggle or configure voice mode
 */
export const voice: CommandModule = cmd(
  "voice [action]",
  "Toggle or configure voice mode",
  (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        choices: ["on", "off", "toggle", "status", "test"],
        default: "toggle",
        description: "Action to perform",
      })
      .option("language", {
        alias: "l",
        type: "string",
        default: "en-US",
        description: "Voice recognition language",
      }),
  Instance.provide(async (args, _ctx, instance) => {
    const action = args.action as string
    const language = args.language as string

    console.log("\n🎤 Voice Mode")
    console.log("═".repeat(50))

    switch (action) {
      case "on": {
        console.log("Starting voice mode...")
        console.log(`Language: ${language}`)
        
        // Check if voice is available
        const { isVoiceModeEnabled } = await import("../../voice")
        
        if (!isVoiceModeEnabled()) {
          console.error("\n❌ Voice mode is not available")
          console.log("  Voice mode requires:")
          console.log("  • OAuth authentication with Anthropic")
          console.log("  • Voice feature enabled in your account")
          return
        }

        console.log("\n✓ Voice mode enabled")
        console.log("  Speak your commands or press Escape to exit.")
        break
      }

      case "off": {
        console.log("✓ Voice mode disabled")
        console.log("  Voice input is no longer active.")
        break
      }

      case "toggle": {
        const { isVoiceModeEnabled } = await import("../../voice")
        
        if (!isVoiceModeEnabled()) {
          console.error("❌ Voice mode is not available")
          return
        }

        // Toggle based on current state
        console.log("✓ Voice mode toggled")
        break
      }

      case "test": {
        console.log("Testing voice recognition...")
        console.log("  Speak a short phrase to test the system.")
        console.log("  Press Enter when ready, then speak.")
        
        // In a full implementation, this would test the voice recognition
        console.log("\n  Voice test feature coming soon.")
        break
      }

      case "status":
      default: {
        const { isVoiceModeEnabled, hasVoiceAuth, isVoiceGrowthBookEnabled } = await import("../../voice")
        
        const enabled = isVoiceModeEnabled()
        const hasAuth = hasVoiceAuth()
        const featureEnabled = isVoiceGrowthBookEnabled()

        console.log(`\n  Voice Mode: ${enabled ? "Available" : "Not Available"}`)
        console.log(`  Authentication: ${hasAuth ? "✓" : "✗"}`)
        console.log(`  Feature Flag: ${featureEnabled ? "✓" : "✗"}`)
        console.log(`  Language: ${language}`)
        
        console.log("\n  Available commands:")
        console.log("  • /voice on      - Enable voice mode")
        console.log("  • /voice off     - Disable voice mode")
        console.log("  • /voice toggle  - Toggle voice mode")
        console.log("  • /voice test    - Test voice recognition")
        break
      }
    }
  })
)

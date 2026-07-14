import { cmd, Instance } from "./cmd"
import type { CommandModule } from "yargs"

/**
 * /share command - Share session or output
 */
export const share: CommandModule = cmd(
  "share [target]",
  "Share session or output with others",
  (yargs) =>
    yargs
      .positional("target", {
        type: "string",
        choices: ["session", "last", "code"],
        default: "session",
        description: "What to share",
      })
      .option("format", {
        alias: "f",
        type: "string",
        choices: ["link", "json", "markdown"],
        default: "link",
        description: "Share format",
      })
      .option("expires", {
        alias: "e",
        type: "string",
        default: "7d",
        description: "Expiration time (e.g., 1h, 7d, never)",
      }),
  Instance.provide(async (args, _ctx, instance) => {
    const target = args.target as string
    const format = args.format as string
    const expires = args.expires as string

    console.log("\n🔗 Share")
    console.log("═".repeat(50))

    console.log(`\n  Sharing: ${target}`)
    console.log(`  Format: ${format}`)
    console.log(`  Expires: ${expires}`)

    switch (format) {
      case "link": {
        // In a full implementation, this would create a shareable link
        console.log("\n  Creating shareable link...")
        console.log("  ✓ Link created (feature coming soon)")
        break
      }

      case "json": {
        console.log("\n  Exporting as JSON...")
        console.log("  ✓ JSON exported (feature coming soon)")
        break
      }

      case "markdown": {
        console.log("\n  Exporting as Markdown...")
        console.log("  ✓ Markdown exported (feature coming soon)")
        break
      }
    }

    console.log("\n💡 Tips:")
    console.log("  - Use /share session to share entire conversation")
    console.log("  - Use /share last to share only the last response")
    console.log("  - Use /share code to share only code blocks")
  })
)

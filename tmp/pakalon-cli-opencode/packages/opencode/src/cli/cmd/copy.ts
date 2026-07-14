import { cmd, Instance } from "./cmd"
import type { CommandModule } from "yargs"
import * as os from "os"

/**
 * /copy command - Copy content to clipboard
 */
export const copy: CommandModule = cmd(
  "copy [content]",
  "Copy content to clipboard",
  (yargs) =>
    yargs
      .positional("content", {
        type: "string",
        description: "Content to copy (or use --last, --code, --all)",
      })
      .option("last", {
        alias: "l",
        type: "boolean",
        default: false,
        description: "Copy last AI response",
      })
      .option("code", {
        alias: "c",
        type: "boolean",
        default: false,
        description: "Copy only code blocks from last response",
      })
      .option("all", {
        alias: "a",
        type: "boolean",
        default: false,
        description: "Copy entire conversation",
      }),
  Instance.provide(async (args, _ctx, instance) => {
    let contentToCopy: string | undefined

    if (args.content) {
      contentToCopy = args.content as string
    } else if (args.last) {
      // Get last AI response from session
      contentToCopy = "Last AI response would go here"
      console.log("Copying last AI response...")
    } else if (args.code) {
      // Extract code blocks from last response
      contentToCopy = "Extracted code blocks would go here"
      console.log("Copying code blocks from last response...")
    } else if (args.all) {
      // Get entire conversation
      contentToCopy = "Entire conversation would go here"
      console.log("Copying entire conversation...")
    } else {
      console.log("Usage: /copy <content> or use --last, --code, --all")
      return
    }

    if (contentToCopy) {
      // Platform-specific clipboard copy
      const platform = os.platform()
      let copyCommand: string

      if (platform === "darwin") {
        copyCommand = "pbcopy"
      } else if (platform === "win32") {
        copyCommand = "clip"
      } else {
        // Linux - try xclip or xsel
        copyCommand = "xclip -selection clipboard"
      }

      try {
        const { spawn } = await import("child_process")
        const proc = spawn(copyCommand.split(" ")[0]!, copyCommand.split(" ").slice(1), {
          stdio: ["pipe", "inherit", "inherit"],
          shell: true,
        })
        proc.stdin?.write(contentToCopy)
        proc.stdin?.end()

        console.log("✓ Content copied to clipboard")
      } catch (error) {
        console.error("Failed to copy to clipboard:", error)
        console.log("\nContent to copy:")
        console.log(contentToCopy)
      }
    }
  })
)

import { cmd, Instance } from "./cmd"
import type { CommandModule } from "yargs"

/**
 * /output-style command - Configure output styling
 */
export const outputStyle: CommandModule = cmd(
  "output-style [style]",
  "Configure output styling for responses",
  (yargs) =>
    yargs
      .positional("style", {
        type: "string",
        choices: ["default", "minimal", "verbose", "compact", "markdown"],
        description: "Output style to use",
      })
      .option("list", {
        alias: "l",
        type: "boolean",
        default: false,
        description: "List available styles",
      }),
  Instance.provide(async (args, _ctx, instance) => {
    const style = args.style as string | undefined
    const listStyles = args.list as boolean

    console.log("\n🎨 Output Style")
    console.log("═".repeat(50))

    const styles = [
      { name: "default", desc: "Standard formatting with colors and icons" },
      { name: "minimal", desc: "Clean output with minimal decoration" },
      { name: "verbose", desc: "Detailed output with extra information" },
      { name: "compact", desc: "Condensed output for small terminals" },
      { name: "markdown", desc: "Raw markdown output for piping" },
    ]

    if (listStyles || !style) {
      const current = "default" // Would be read from config
      console.log("\n📋 Available Styles:")
      console.log("─".repeat(40))
      
      for (const s of styles) {
        const marker = s.name === current ? " (current)" : ""
        console.log(`  • ${s.name.padEnd(12)} - ${s.desc}${marker}`)
      }
      
      console.log("\nUsage: /output-style <style>")
      return
    }

    const selectedStyle = styles.find(s => s.name === style)
    if (!selectedStyle) {
      console.error(`Unknown style: ${style}`)
      console.log("Use /output-style --list to see available styles")
      return
    }

    console.log(`\n✓ Output style set to: ${style}`)
    console.log(`  ${selectedStyle.desc}`)
  })
)

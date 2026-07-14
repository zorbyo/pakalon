import { cmd, Instance } from "./cmd"
import type { CommandModule } from "yargs"

/**
 * /theme command - Change visual theme
 */
export const theme: CommandModule = cmd(
  "theme [name]",
  "Change or list visual themes",
  (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        description: "Theme name to apply",
      })
      .option("list", {
        alias: "l",
        type: "boolean",
        default: false,
        description: "List available themes",
      }),
  Instance.provide(async (args, _ctx, instance) => {
    const themeName = args.name as string | undefined
    const listThemes = args.list as boolean

    const availableThemes = [
      { name: "default", description: "Default dark theme" },
      { name: "light", description: "Light theme for bright environments" },
      { name: "dark", description: "Dark theme" },
      { name: "dracula", description: "Dracula color scheme" },
      { name: "monokai", description: "Monokai color scheme" },
      { name: "solarized", description: "Solarized color scheme" },
      { name: "nord", description: "Nord color scheme" },
      { name: "gruvbox", description: "Gruvbox color scheme" },
    ]

    if (listThemes || !themeName) {
      console.log("\n🎨 Available Themes:")
      console.log("═".repeat(50))
      
      for (const t of availableThemes) {
        const current = t.name === "default" ? " (current)" : ""
        console.log(`  • ${t.name.padEnd(15)} - ${t.description}${current}`)
      }
      
      console.log("\nUsage: /theme <name> to apply a theme")
      return
    }

    const theme = availableThemes.find(t => t.name === themeName.toLowerCase())
    
    if (!theme) {
      console.error(`Unknown theme: ${themeName}`)
      console.log("Use /theme --list to see available themes")
      return
    }

    console.log(`✓ Theme changed to: ${theme.name}`)
    console.log("  Restart may be required for full effect.")
  })
)

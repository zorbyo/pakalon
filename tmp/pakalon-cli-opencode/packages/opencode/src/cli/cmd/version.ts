import { cmd } from "./cmd"
import { UI } from "../ui"
import fs from "fs/promises"
import path from "path"

export const VersionCommand = cmd({
  command: "version",
  describe: "Show version information",
  builder: (yargs) => yargs,
  async handler() {
    // Try to read version from package.json
    let version = "unknown"
    let name = "pakalon-cli"

    try {
      // Look for package.json in several locations
      const locations = [
        path.join(process.cwd(), "package.json"),
        path.join(__dirname, "..", "..", "..", "package.json"),
        path.join(__dirname, "..", "..", "..", "..", "package.json"),
      ]

      for (const loc of locations) {
        try {
          const content = await fs.readFile(loc, "utf-8")
          const pkg = JSON.parse(content)
          if (pkg.name && pkg.name.includes("pakalon") || pkg.name.includes("opencode")) {
            version = pkg.version || "unknown"
            name = pkg.name || name
            break
          }
        } catch {
          continue
        }
      }
    } catch {
      // Ignore errors
    }

    UI.println(UI.Style.TEXT_HIGHLIGHT + name)
    UI.println(`Version: ${UI.Style.TEXT_INFO}${version}${UI.Style.RESET}`)
    UI.empty()
    UI.println(`Node.js: ${process.version}`)
    UI.println(`Platform: ${process.platform} ${process.arch}`)
    UI.println(`Working Directory: ${process.cwd()}`)
  },
})

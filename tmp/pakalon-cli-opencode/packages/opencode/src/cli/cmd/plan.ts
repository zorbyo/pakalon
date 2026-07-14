import { cmd } from "./cmd"
import { UI } from "../ui"

interface PlanArgs {
  file?: string
  create?: boolean
}

export const PlanCommand = cmd({
  command: "plan [file]",
  describe: "View or create implementation plans",
  builder: (yargs) =>
    yargs
      .positional("file", {
        type: "string",
        describe: "Plan file to view (default: .pakalon/plan.md)",
      })
      .option("create", {
        type: "boolean",
        alias: "c",
        describe: "Create a new plan interactively",
      }),
  async handler(args: PlanArgs) {
    const fs = await import("fs/promises")
    const path = await import("path")

    const planFile = args.file || path.join(process.cwd(), ".pakalon", "plan.md")

    if (args.create) {
      UI.println(UI.Style.TEXT_INFO + "Creating new plan...")
      UI.println(UI.Style.TEXT_DIM + "Use the AI assistant to help create your plan.")
      UI.println(UI.Style.TEXT_DIM + "Try: 'Create a plan for implementing feature X'")
      return
    }

    // Read and display plan
    try {
      const content = await fs.readFile(planFile, "utf-8")
      
      UI.println(UI.Style.TEXT_HIGHLIGHT + `Plan: ${planFile}`)
      UI.empty()

      // Parse and display the plan with formatting
      const lines = content.split("\n")
      for (const line of lines) {
        if (line.startsWith("# ")) {
          UI.println(UI.Style.TEXT_HIGHLIGHT + line)
        } else if (line.startsWith("## ")) {
          UI.println(UI.Style.TEXT_INFO + line)
        } else if (line.startsWith("- [ ]")) {
          UI.println("  ☐ " + line.slice(5))
        } else if (line.startsWith("- [x]") || line.startsWith("- [X]")) {
          UI.println(UI.Style.TEXT_SUCCESS + "  ✓ " + line.slice(5) + UI.Style.RESET)
        } else if (line.startsWith("- ")) {
          UI.println("  • " + line.slice(2))
        } else {
          UI.println(line)
        }
      }

    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        UI.println(UI.Style.TEXT_WARN + `Plan file not found: ${planFile}`)
        UI.println(UI.Style.TEXT_DIM + "Run /init to create .pakalon folder structure")
        UI.println(UI.Style.TEXT_DIM + "Or use /plan --create to create a new plan")
      } else {
        UI.println(UI.Style.TEXT_ERROR + `Failed to read plan: ${error}`)
      }
    }
  },
})

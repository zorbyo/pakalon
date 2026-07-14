import { cmd, Instance } from "./cmd"
import type { CommandModule } from "yargs"
import * as fs from "fs"
import * as path from "path"

/**
 * /add-dir command - Add a directory to context
 */
export const addDir: CommandModule = cmd(
  "add-dir <path>",
  "Add a directory to the conversation context",
  (yargs) =>
    yargs
      .positional("path", {
        type: "string",
        demandOption: true,
        description: "Directory path to add",
      })
      .option("recursive", {
        alias: "r",
        type: "boolean",
        default: true,
        description: "Include subdirectories",
      })
      .option("pattern", {
        alias: "p",
        type: "string",
        description: "Glob pattern to filter files (e.g., '*.ts')",
      })
      .option("exclude", {
        alias: "e",
        type: "array",
        default: ["node_modules", ".git", "dist", "build"],
        description: "Directories to exclude",
      }),
  Instance.provide(async (args, _ctx, instance) => {
    const targetPath = args.path as string
    const recursive = args.recursive as boolean
    const pattern = args.pattern as string | undefined
    const excludeDirs = args.exclude as string[]

    const resolvedPath = path.resolve(process.cwd(), targetPath)

    if (!fs.existsSync(resolvedPath)) {
      console.error(`Error: Directory not found: ${resolvedPath}`)
      return
    }

    const stat = fs.statSync(resolvedPath)
    if (!stat.isDirectory()) {
      console.error(`Error: Not a directory: ${resolvedPath}`)
      return
    }

    console.log("\n📁 Adding Directory to Context")
    console.log("═".repeat(50))
    console.log(`\nDirectory: ${resolvedPath}`)
    console.log(`Recursive: ${recursive}`)
    console.log(`Pattern: ${pattern || "all files"}`)
    console.log(`Excluding: ${excludeDirs.join(", ")}`)

    // Count files that would be added
    let fileCount = 0
    const countFiles = (dir: string): void => {
      const items = fs.readdirSync(dir)
      for (const item of items) {
        if (excludeDirs.includes(item)) continue
        
        const fullPath = path.join(dir, item)
        const itemStat = fs.statSync(fullPath)
        
        if (itemStat.isDirectory() && recursive) {
          countFiles(fullPath)
        } else if (itemStat.isFile()) {
          if (!pattern || matchPattern(item, pattern)) {
            fileCount++
          }
        }
      }
    }

    countFiles(resolvedPath)

    console.log(`\n✓ Found ${fileCount} file(s) to add`)
    console.log("  Files will be included in the conversation context.")
  })
)

function matchPattern(filename: string, pattern: string): boolean {
  const regex = pattern
    .replace(/\./g, "\\.")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  return new RegExp(`^${regex}$`, "i").test(filename)
}

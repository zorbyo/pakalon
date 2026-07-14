import { cmd, Instance } from "./cmd"
import type { CommandModule } from "yargs"
import * as fs from "fs"
import * as path from "path"

/**
 * /files command - List and manage files in context
 */
export const files: CommandModule = cmd(
  "files [pattern]",
  "List files in working directory or matching pattern",
  (yargs) =>
    yargs
      .positional("pattern", {
        type: "string",
        description: "Glob pattern to filter files",
      })
      .option("all", {
        alias: "a",
        type: "boolean",
        default: false,
        description: "Include hidden files",
      })
      .option("tree", {
        alias: "t",
        type: "boolean",
        default: false,
        description: "Show as tree view",
      })
      .option("depth", {
        alias: "d",
        type: "number",
        default: 2,
        description: "Maximum depth for tree view",
      }),
  Instance.provide(async (args, _ctx, instance) => {
    const cwd = process.cwd()
    const pattern = args.pattern as string | undefined
    const showHidden = args.all as boolean
    const treeView = args.tree as boolean
    const maxDepth = args.depth as number

    console.log(`\n📁 Files in ${cwd}`)
    console.log("═".repeat(60))

    if (treeView) {
      printTree(cwd, "", showHidden, 0, maxDepth)
    } else {
      const files = listFiles(cwd, showHidden, pattern)
      for (const file of files) {
        const stat = fs.statSync(path.join(cwd, file))
        const type = stat.isDirectory() ? "📁" : "📄"
        const size = stat.isDirectory() ? "" : formatSize(stat.size)
        console.log(`  ${type} ${file.padEnd(40)} ${size}`)
      }
      console.log(`\nTotal: ${files.length} items`)
    }
  })
)

function listFiles(dir: string, showHidden: boolean, pattern?: string): string[] {
  try {
    let files = fs.readdirSync(dir)
    
    if (!showHidden) {
      files = files.filter(f => !f.startsWith("."))
    }

    if (pattern) {
      const regex = globToRegex(pattern)
      files = files.filter(f => regex.test(f))
    }

    return files.sort((a, b) => {
      const aIsDir = fs.statSync(path.join(dir, a)).isDirectory()
      const bIsDir = fs.statSync(path.join(dir, b)).isDirectory()
      if (aIsDir && !bIsDir) return -1
      if (!aIsDir && bIsDir) return 1
      return a.localeCompare(b)
    })
  } catch (error) {
    return []
  }
}

function printTree(dir: string, prefix: string, showHidden: boolean, depth: number, maxDepth: number): void {
  if (depth > maxDepth) return

  const files = listFiles(dir, showHidden)
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!
    const filePath = path.join(dir, file)
    const isLast = i === files.length - 1
    const stat = fs.statSync(filePath)
    const isDir = stat.isDirectory()
    
    const connector = isLast ? "└── " : "├── "
    const icon = isDir ? "📁" : "📄"
    
    console.log(`${prefix}${connector}${icon} ${file}`)
    
    if (isDir && depth < maxDepth) {
      const newPrefix = prefix + (isLast ? "    " : "│   ")
      printTree(filePath, newPrefix, showHidden, depth + 1, maxDepth)
    }
  }
}

function globToRegex(glob: string): RegExp {
  const regex = glob
    .replace(/\./g, "\\.")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  return new RegExp(`^${regex}$`, "i")
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

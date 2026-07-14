import { cmd } from "./cmd"
import { Instance } from "@/project/instance"
import { UI } from "../ui"
import { spawn } from "child_process"

interface ReviewArgs {
  file?: string
  all?: boolean
}

export const ReviewCommand = cmd({
  command: "review [file]",
  describe: "Review code changes with AI assistance",
  builder: (yargs) =>
    yargs
      .positional("file", {
        type: "string",
        describe: "Specific file to review",
      })
      .option("all", {
        type: "boolean",
        alias: "a",
        describe: "Review all changes (staged and unstaged)",
      }),
  async handler(args: ReviewArgs) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const worktree = Instance.worktree

        UI.println(UI.Style.TEXT_INFO + "Analyzing code changes...")
        UI.empty()

        // Get diff
        const diffArgs = ["--no-pager", "diff"]
        if (!args.all) {
          diffArgs.push("--cached")
        }
        if (args.file) {
          diffArgs.push("--", args.file)
        }

        const diff = await runGitCommand(worktree, diffArgs)

        if (!diff.stdout.trim()) {
          UI.println(UI.Style.TEXT_WARN + "No changes to review.")
          UI.println(UI.Style.TEXT_DIM + "Stage changes with 'git add' or use --all to review unstaged changes.")
          return
        }

        // Parse and analyze the diff
        const lines = diff.stdout.split("\n")
        const stats = analyzeDiff(lines)

        UI.println(UI.Style.TEXT_HIGHLIGHT + "Code Review Summary")
        UI.empty()

        UI.println(`Files changed: ${stats.filesChanged}`)
        UI.println(`${UI.Style.TEXT_SUCCESS}+${stats.additions}${UI.Style.RESET} / ${UI.Style.TEXT_ERROR}-${stats.deletions}${UI.Style.RESET}`)
        UI.empty()

        // Show file-by-file summary
        for (const file of stats.files) {
          UI.println(`${UI.Style.TEXT_INFO}${file.name}${UI.Style.RESET}`)
          UI.println(`  ${UI.Style.TEXT_SUCCESS}+${file.additions}${UI.Style.RESET} / ${UI.Style.TEXT_ERROR}-${file.deletions}${UI.Style.RESET}`)
        }
        UI.empty()

        // Review suggestions (in real implementation, this would use AI)
        UI.println(UI.Style.TEXT_HIGHLIGHT + "Review Suggestions:")
        UI.println(UI.Style.TEXT_DIM + "  • Consider adding tests for new functionality")
        UI.println(UI.Style.TEXT_DIM + "  • Ensure documentation is updated")
        UI.println(UI.Style.TEXT_DIM + "  • Check for any hardcoded values")
      },
    })
  },
})

interface DiffStats {
  filesChanged: number
  additions: number
  deletions: number
  files: Array<{ name: string; additions: number; deletions: number }>
}

function analyzeDiff(lines: string[]): DiffStats {
  const stats: DiffStats = {
    filesChanged: 0,
    additions: 0,
    deletions: 0,
    files: [],
  }

  let currentFile: { name: string; additions: number; deletions: number } | null = null

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      if (currentFile) {
        stats.files.push(currentFile)
      }
      const match = line.match(/b\/(.+)$/)
      currentFile = { name: match?.[1] || "unknown", additions: 0, deletions: 0 }
      stats.filesChanged++
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      stats.additions++
      if (currentFile) currentFile.additions++
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      stats.deletions++
      if (currentFile) currentFile.deletions++
    }
  }

  if (currentFile) {
    stats.files.push(currentFile)
  }

  return stats
}

async function runGitCommand(cwd: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    
    let stdout = ""
    let stderr = ""

    proc.stdout?.on("data", (data) => {
      stdout += data.toString()
    })

    proc.stderr?.on("data", (data) => {
      stderr += data.toString()
    })

    proc.on("exit", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr })
    })

    proc.on("error", (err) => {
      resolve({ exitCode: 1, stdout: "", stderr: err.message })
    })
  })
}

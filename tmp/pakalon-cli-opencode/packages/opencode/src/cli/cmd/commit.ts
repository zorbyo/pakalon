import { cmd } from "./cmd"
import { Instance } from "@/project/instance"
import { UI } from "../ui"
import { spawn } from "child_process"

interface CommitArgs {
  message?: string
  all?: boolean
  amend?: boolean
}

export const CommitCommand = cmd({
  command: "commit",
  describe: "Create a git commit with optional AI-generated message",
  builder: (yargs) =>
    yargs
      .option("message", {
        type: "string",
        alias: "m",
        describe: "Commit message (if not provided, AI will generate one)",
      })
      .option("all", {
        type: "boolean",
        alias: "a",
        describe: "Stage all modified files before committing",
      })
      .option("amend", {
        type: "boolean",
        describe: "Amend the previous commit",
      }),
  async handler(args: CommitArgs) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const worktree = Instance.worktree

        // Check if there are staged changes
        const checkStaged = await runGitCommand(worktree, ["diff", "--cached", "--quiet"])
        const hasStagedChanges = checkStaged.exitCode !== 0

        // If --all flag is set, stage all changes
        if (args.all) {
          UI.println(UI.Style.TEXT_INFO + "Staging all changes...")
          await runGitCommand(worktree, ["add", "-A"])
        } else if (!hasStagedChanges) {
          UI.println(UI.Style.TEXT_WARN + "No staged changes. Use -a to stage all changes, or git add files first.")
          return
        }

        // Get the diff for AI analysis if no message provided
        let commitMessage = args.message

        if (!commitMessage) {
          UI.println(UI.Style.TEXT_INFO + "Analyzing changes...")
          
          const diff = await runGitCommand(worktree, ["diff", "--cached", "--stat"])
          
          if (diff.stdout.trim()) {
            // Generate a simple commit message based on the diff
            const lines = diff.stdout.trim().split("\n")
            const lastLine = lines[lines.length - 1]
            
            // Parse the summary line like "5 files changed, 100 insertions(+), 20 deletions(-)"
            const match = lastLine.match(/(\d+) files? changed/)
            const filesChanged = match ? parseInt(match[1]) : 0
            
            // Get file names from the diff
            const fileLines = lines.slice(0, -1)
            const files = fileLines.map(line => {
              const parts = line.trim().split("|")
              return parts[0]?.trim() || ""
            }).filter(Boolean)

            // Generate message
            if (filesChanged === 1 && files[0]) {
              commitMessage = `Update ${files[0].split("/").pop()}`
            } else if (filesChanged > 0) {
              const primaryFile = files[0]?.split("/").pop() || "files"
              commitMessage = `Update ${primaryFile} and ${filesChanged - 1} other file${filesChanged > 2 ? "s" : ""}`
            } else {
              commitMessage = "Update code"
            }

            UI.println(UI.Style.TEXT_DIM + `Suggested message: ${commitMessage}`)
          } else {
            commitMessage = "Update code"
          }
        }

        // Build commit command
        const commitArgs = ["commit"]
        
        if (args.amend) {
          commitArgs.push("--amend")
        }
        
        commitArgs.push("-m", commitMessage)

        UI.println(UI.Style.TEXT_INFO + "Creating commit...")
        const result = await runGitCommand(worktree, commitArgs)

        if (result.exitCode === 0) {
          UI.println(UI.Style.TEXT_SUCCESS + "✓ Commit created successfully")
          UI.println(UI.Style.TEXT_DIM + result.stdout)
        } else {
          UI.println(UI.Style.TEXT_ERROR + "Failed to create commit:")
          UI.println(result.stderr || result.stdout)
        }
      },
    })
  },
})

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

import { cmd } from "./cmd"
import { Instance } from "@/project/instance"
import { UI } from "../ui"
import { spawn } from "child_process"

interface DiffArgs {
  staged?: boolean
  stat?: boolean
  file?: string
}

export const DiffCommand = cmd({
  command: "diff [file]",
  describe: "Show git diff with optional file filter",
  builder: (yargs) =>
    yargs
      .positional("file", {
        type: "string",
        describe: "Specific file to diff",
      })
      .option("staged", {
        type: "boolean",
        alias: "s",
        describe: "Show staged changes only",
      })
      .option("stat", {
        type: "boolean",
        describe: "Show diffstat only",
      }),
  async handler(args: DiffArgs) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const worktree = Instance.worktree

        // Build git diff command
        const diffArgs = ["--no-pager", "diff"]
        
        if (args.staged) {
          diffArgs.push("--cached")
        }
        
        if (args.stat) {
          diffArgs.push("--stat")
        }

        if (args.file) {
          diffArgs.push("--", args.file)
        }

        const result = await runGitCommand(worktree, diffArgs)

        if (result.exitCode !== 0) {
          UI.println(UI.Style.TEXT_ERROR + "Failed to get diff:")
          UI.println(result.stderr)
          return
        }

        if (!result.stdout.trim()) {
          if (args.staged) {
            UI.println(UI.Style.TEXT_INFO + "No staged changes.")
          } else {
            UI.println(UI.Style.TEXT_INFO + "No changes detected.")
          }
          return
        }

        // Colorize the diff output
        const lines = result.stdout.split("\n")
        for (const line of lines) {
          if (line.startsWith("+") && !line.startsWith("+++")) {
            UI.println(UI.Style.TEXT_SUCCESS + line)
          } else if (line.startsWith("-") && !line.startsWith("---")) {
            UI.println(UI.Style.TEXT_ERROR + line)
          } else if (line.startsWith("@@")) {
            UI.println(UI.Style.TEXT_INFO + line)
          } else if (line.startsWith("diff ") || line.startsWith("index ")) {
            UI.println(UI.Style.TEXT_HIGHLIGHT + line)
          } else {
            UI.println(line)
          }
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

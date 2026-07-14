import { UI } from "../ui"
import { cmd } from "./cmd"
import { Instance } from "@/project/instance"
import { Process } from "@/util/process"
import { git } from "@/util/git"
import * as prompts from "@clack/prompts"

export const DelegateCommand = cmd({
  command: "delegate <task>",
  describe: "delegate a task to a remote repository via an AI-generated PR",
  builder: (yargs) =>
    yargs
      .positional("task", {
        type: "string",
        describe: "The task description to delegate to the remote repository",
        demandOption: true,
      })
      .option("repo", {
        alias: "r",
        type: "string",
        describe: "Target repository in owner/repo format (e.g., myorg/myrepo)",
      })
      .option("branch", {
        alias: "b",
        type: "string",
        describe: "Base branch to create the PR from (defaults to default branch)",
      })
      .option("title", {
        alias: "t",
        type: "string",
        describe: "PR title (auto-generated from task if not provided)",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const project = Instance.project
        if (project.vcs !== "git") {
          UI.error("Could not find git repository. Please run this command from a git repository.")
          process.exit(1)
        }

        // Determine target repository
        let targetRepo = args.repo
        if (!targetRepo) {
          // Try to detect from git remote
          const remoteResult = await git(["remote", "get-url", "origin"], {
            cwd: Instance.worktree,
          }).catch(() => undefined)

          if (remoteResult && remoteResult.exitCode === 0) {
            const remoteUrl = remoteResult.text().trim()
            const match = remoteUrl.match(/github\.com[:/]([^/]+\/[^/.]+)/)
            if (match) {
              targetRepo = match[1]
            }
          }

          if (!targetRepo) {
            UI.error("Could not determine target repository. Use --repo to specify (e.g., myorg/myrepo)")
            process.exit(1)
          }
        }

        prompts.intro(`Delegating task to ${targetRepo}`)
        prompts.log.info(`Task: ${args.task}`)

        // Check if gh CLI is available
        const ghCheck = await Process.text(["gh", "--version"], { nothrow: true })
        if (ghCheck.code !== 0) {
          UI.error("GitHub CLI (gh) is not installed. Please install it: https://cli.github.com/")
          process.exit(1)
        }

        // Check authentication
        const authCheck = await Process.text(["gh", "auth", "status"], { nothrow: true })
        if (authCheck.code !== 0) {
          UI.error("GitHub CLI is not authenticated. Run: gh auth login")
          process.exit(1)
        }

        const title = args.title ?? `AI: ${args.task.slice(0, 72)}`
        const branchName = `delegate/${Date.now().toString(36)}`

        // Clone the target repository to a temp directory
        const tempDir = `/tmp/pakalon-delegate-${Date.now()}`
        UI.println(`Cloning ${targetRepo}...`)

        const cloneResult = await Process.text(
          ["gh", "repo", "clone", targetRepo, tempDir, "--depth=1"],
          { nothrow: true },
        )

        if (cloneResult.code !== 0) {
          UI.error(`Failed to clone ${targetRepo}: ${cloneResult.text}`)
          process.exit(1)
        }

        // Create a new branch
        await git(["checkout", "-b", branchName], { cwd: tempDir })

        UI.println("Running pakalon to implement the task...")

        // Run pakalon in the cloned repo with the task
        const { spawn } = await import("child_process")
        const pakalonProcess = spawn(
          "pakalon",
          ["run", "--prompt", args.task],
          {
            stdio: "inherit",
            cwd: tempDir,
            env: {
              ...process.env,
              PAKALON_DELEGATE_MODE: "1",
            },
          },
        )

        await new Promise<void>((resolve, reject) => {
          pakalonProcess.on("exit", (code) => {
            if (code === 0) resolve()
            else reject(new Error(`pakalon exited with code ${code}`))
          })
          pakalonProcess.on("error", reject)
        }).catch((err) => {
          UI.error(`Task execution failed: ${err.message}`)
          // Cleanup
          Process.run(["rm", "-rf", tempDir], { nothrow: true })
          process.exit(1)
        })

        // Check if there are changes to commit
        const statusResult = await git(["status", "--porcelain"], { cwd: tempDir })
        if (!statusResult.text().trim()) {
          prompts.log.info("No changes were made. Nothing to create a PR for.")
          await Process.run(["rm", "-rf", tempDir], { nothrow: true })
          return
        }

        // Commit changes with co-authored-by trailer
        await git(["add", "-A"], { cwd: tempDir })
        const commitMessage = `${title}\n\nCo-authored-by: pakalon[bot] <pakalon@users.noreply.github.com>`
        await git(["commit", "-m", commitMessage, "--author=Pakalon AI <pakalon@users.noreply.github.com>"], {
          cwd: tempDir,
        })

        // Push and create PR
        UI.println("Creating pull request...")

        await git(["push", "-u", "origin", branchName], { cwd: tempDir })

        const prResult = await Process.text(
          [
            "gh",
            "pr",
            "create",
            "--repo",
            targetRepo,
            "--title",
            title,
            "--body",
            `## Delegated Task\n\n${args.task}\n\n---\n*Created by Pakalon CLI*`,
            "--head",
            branchName,
          ],
          { cwd: tempDir, nothrow: true },
        )

        if (prResult.code !== 0) {
          UI.error(`Failed to create PR: ${prResult.text}`)
          process.exit(1)
        }

        prompts.log.success(`PR created: ${prResult.text.trim()}`)

        // Cleanup
        await Process.run(["rm", "-rf", tempDir], { nothrow: true })
        prompts.outro("Delegate task completed")
      },
    })
  },
})

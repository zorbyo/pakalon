import { cmd } from "./cmd"
import { UI } from "../ui"
import { git } from "../../util/git"

type BranchAction = "list" | "current" | "create" | "switch" | "delete"

interface BranchArgs {
  action?: string
  name?: string
  from?: string
  all?: boolean
  force?: boolean
  json?: boolean
}

function normalizeAction(value?: string): BranchAction {
  const normalized = value?.trim().toLowerCase()
  if (normalized === "current") return "current"
  if (normalized === "create") return "create"
  if (normalized === "switch") return "switch"
  if (normalized === "delete") return "delete"
  return "list"
}

function parseBranchLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const current = line.startsWith("*")
      const name = line.replace(/^\*/, "").trim()
      return { name, current }
    })
}

export const BranchCommand = cmd({
  command: "branch [action] [name]",
  describe: "git branch operations (list, current, create, switch, delete)",
  builder: (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        choices: ["list", "current", "create", "switch", "delete"] as const,
        default: "list",
        describe: "Branch action to perform",
      })
      .positional("name", {
        type: "string",
        describe: "Branch name for create/switch/delete",
      })
      .option("from", {
        type: "string",
        describe: "Starting point for create action (default: current HEAD)",
      })
      .option("all", {
        alias: "a",
        type: "boolean",
        default: false,
        describe: "List all branches including remotes",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "Force deletion for delete action",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output JSON",
      }),
  handler: async (rawArgs) => {
    const args: BranchArgs = {
      action: typeof rawArgs.action === "string" ? rawArgs.action : undefined,
      name: typeof rawArgs.name === "string" ? rawArgs.name : undefined,
      from: typeof rawArgs.from === "string" ? rawArgs.from : undefined,
      all: Boolean(rawArgs.all),
      force: Boolean(rawArgs.force),
      json: Boolean(rawArgs.json),
    }

    const cwd = process.cwd()
    const action = normalizeAction(args.action)
    const branchName = args.name?.trim()

    if ((action === "create" || action === "switch" || action === "delete") && !branchName) {
      UI.error("Branch name is required for this action.")
      process.exitCode = 1
      return
    }

    if (action === "list") {
      const result = await git(["branch", args.all ? "--all" : "--list"], { cwd })
      if (result.exitCode !== 0) {
        UI.error(result.stderr.toString().trim() || "Failed to list branches.")
        process.exitCode = 1
        return
      }

      const branches = parseBranchLines(result.text())
      if (args.json) {
        console.log(JSON.stringify({ action, branches }, null, 2))
        return
      }

      UI.println(UI.Style.TEXT_HIGHLIGHT + "Git Branches" + UI.Style.TEXT_NORMAL)
      UI.empty()
      if (branches.length === 0) {
        UI.println(UI.Style.TEXT_DIM + "No branches found." + UI.Style.TEXT_NORMAL)
        return
      }
      for (const branch of branches) {
        const marker = branch.current ? `${UI.Style.TEXT_SUCCESS_BOLD}*${UI.Style.TEXT_NORMAL}` : " "
        UI.println(`${marker} ${branch.name}`)
      }
      return
    }

    if (action === "current") {
      const result = await git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd })
      if (result.exitCode !== 0) {
        UI.error(result.stderr.toString().trim() || "Failed to resolve current branch.")
        process.exitCode = 1
        return
      }
      const current = result.text().trim()
      if (args.json) {
        console.log(JSON.stringify({ action, branch: current }, null, 2))
        return
      }
      UI.println(UI.Style.TEXT_INFO + "Current branch:" + UI.Style.TEXT_NORMAL + ` ${current}`)
      return
    }

    if (action === "create") {
      const command = ["checkout", "-b", branchName!]
      if (args.from) command.push(args.from)
      const result = await git(command, { cwd })
      if (result.exitCode !== 0) {
        UI.error(result.stderr.toString().trim() || `Failed to create branch \"${branchName}\".`)
        process.exitCode = 1
        return
      }
      if (args.json) {
        console.log(JSON.stringify({ action, branch: branchName, from: args.from ?? null }, null, 2))
        return
      }
      UI.println(UI.Style.TEXT_SUCCESS + `✓ Created and switched to ${branchName}` + UI.Style.TEXT_NORMAL)
      return
    }

    if (action === "switch") {
      const result = await git(["checkout", branchName!], { cwd })
      if (result.exitCode !== 0) {
        UI.error(result.stderr.toString().trim() || `Failed to switch to branch \"${branchName}\".`)
        process.exitCode = 1
        return
      }
      if (args.json) {
        console.log(JSON.stringify({ action, branch: branchName }, null, 2))
        return
      }
      UI.println(UI.Style.TEXT_SUCCESS + `✓ Switched to ${branchName}` + UI.Style.TEXT_NORMAL)
      return
    }

    const result = await git(["branch", args.force ? "-D" : "-d", branchName!], { cwd })
    if (result.exitCode !== 0) {
      UI.error(result.stderr.toString().trim() || `Failed to delete branch \"${branchName}\".`)
      process.exitCode = 1
      return
    }
    if (args.json) {
      console.log(JSON.stringify({ action, branch: branchName, force: Boolean(args.force) }, null, 2))
      return
    }
    UI.println(UI.Style.TEXT_SUCCESS + `✓ Deleted ${branchName}` + UI.Style.TEXT_NORMAL)
  },
})

import { cmd } from "./cmd"
import { UI } from "../ui"

interface StatusArgs {
  json?: boolean
}

export const StatusCommand = cmd({
  command: "status",
  describe: "Show current session status",
  builder: (yargs) =>
    yargs.option("json", {
      type: "boolean",
      describe: "Output as JSON",
    }),
  async handler(args: StatusArgs) {
    const status = {
      session: {
        id: "current",
        started: new Date().toISOString(),
        messageCount: 0,
      },
      model: {
        provider: process.env.PAKALON_PROVIDER || "anthropic",
        model: process.env.PAKALON_MODEL || "claude-sonnet-4",
      },
      directory: process.cwd(),
      git: {
        branch: await getGitBranch(),
        hasChanges: await hasUncommittedChanges(),
      },
    }

    if (args.json) {
      console.log(JSON.stringify(status, null, 2))
      return
    }

    UI.println(UI.Style.TEXT_HIGHLIGHT + "Session Status")
    UI.empty()
    
    UI.println(`${UI.Style.TEXT_INFO}Session ID:${UI.Style.RESET} ${status.session.id}`)
    UI.println(`${UI.Style.TEXT_INFO}Started:${UI.Style.RESET} ${status.session.started}`)
    UI.empty()
    
    UI.println(`${UI.Style.TEXT_INFO}Provider:${UI.Style.RESET} ${status.model.provider}`)
    UI.println(`${UI.Style.TEXT_INFO}Model:${UI.Style.RESET} ${status.model.model}`)
    UI.empty()
    
    UI.println(`${UI.Style.TEXT_INFO}Directory:${UI.Style.RESET} ${status.directory}`)
    UI.println(`${UI.Style.TEXT_INFO}Git Branch:${UI.Style.RESET} ${status.git.branch}`)
    UI.println(`${UI.Style.TEXT_INFO}Uncommitted:${UI.Style.RESET} ${status.git.hasChanges ? "Yes" : "No"}`)
  },
})

async function getGitBranch(): Promise<string> {
  const { spawn } = await import("child_process")
  return new Promise((resolve) => {
    const proc = spawn("git", ["branch", "--show-current"], { stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    proc.stdout?.on("data", (data) => { output += data.toString() })
    proc.on("exit", () => resolve(output.trim() || "(detached)"))
    proc.on("error", () => resolve("(not a git repo)"))
  })
}

async function hasUncommittedChanges(): Promise<boolean> {
  const { spawn } = await import("child_process")
  return new Promise((resolve) => {
    const proc = spawn("git", ["status", "--porcelain"], { stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    proc.stdout?.on("data", (data) => { output += data.toString() })
    proc.on("exit", () => resolve(output.trim().length > 0))
    proc.on("error", () => resolve(false))
  })
}

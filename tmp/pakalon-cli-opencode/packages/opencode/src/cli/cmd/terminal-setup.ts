import path from "path"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Filesystem } from "../../util/filesystem"

type ShellKind = "bash" | "zsh" | "fish" | "powershell"

interface TerminalSetupArgs {
  shell?: string
  apply?: boolean
  json?: boolean
}

function detectShell(input?: string): ShellKind {
  const normalizedInput = input?.trim().toLowerCase()
  if (normalizedInput === "bash") return "bash"
  if (normalizedInput === "zsh") return "zsh"
  if (normalizedInput === "fish") return "fish"
  if (normalizedInput === "powershell" || normalizedInput === "pwsh" || normalizedInput === "ps") {
    return "powershell"
  }

  if (process.platform === "win32") return "powershell"

  const shell = (process.env.SHELL ?? "").toLowerCase()
  if (shell.includes("zsh")) return "zsh"
  if (shell.includes("fish")) return "fish"
  return "bash"
}

function getHomeDirectory() {
  return process.env.HOME || process.env.USERPROFILE || process.cwd()
}

function getProfilePath(shell: ShellKind) {
  const home = getHomeDirectory()
  if (shell === "bash") return path.join(home, ".bashrc")
  if (shell === "zsh") return path.join(home, ".zshrc")
  if (shell === "fish") return path.join(home, ".config", "fish", "config.fish")
  return path.join(home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1")
}

function getSetupSnippet(shell: ShellKind) {
  if (shell === "bash" || shell === "zsh") {
    return "# pakalon shell completion\neval \"$(pakalon completion)\""
  }
  if (shell === "fish") {
    return "# pakalon shell completion\npakalon completion > ~/.config/fish/completions/pakalon.fish"
  }
  return "# pakalon shell completion\npakalon completion | Out-String | Invoke-Expression"
}

async function applyShellSetup(profilePath: string, snippet: string) {
  const exists = await Filesystem.exists(profilePath)
  const current = exists ? await Filesystem.readText(profilePath) : ""

  if (current.includes(snippet)) {
    return { updated: false }
  }

  const divider = current.length > 0 && !current.endsWith("\n") ? "\n\n" : "\n"
  const next = `${current}${divider}${snippet}\n`
  await Filesystem.write(profilePath, next)
  return { updated: true }
}

export const TerminalSetupCommand = cmd({
  command: "terminal-setup",
  aliases: ["terminalSetup"],
  describe: "inspect terminal configuration and optionally install completion setup",
  builder: (yargs) =>
    yargs
      .option("shell", {
        type: "string",
        choices: ["bash", "zsh", "fish", "powershell"] as const,
        describe: "Shell to target (auto-detected when omitted)",
      })
      .option("apply", {
        type: "boolean",
        default: false,
        describe: "Append setup snippet to the detected shell profile",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output JSON",
      }),
  handler: async (rawArgs) => {
    const args: TerminalSetupArgs = {
      shell: typeof rawArgs.shell === "string" ? rawArgs.shell : undefined,
      apply: Boolean(rawArgs.apply),
      json: Boolean(rawArgs.json),
    }

    const shell = detectShell(args.shell)
    const profilePath = getProfilePath(shell)
    const snippet = getSetupSnippet(shell)

    let applyResult: { updated: boolean } | null = null
    if (args.apply) {
      applyResult = await applyShellSetup(profilePath, snippet)
    }

    const payload = {
      shell,
      profilePath,
      snippet,
      terminal: {
        platform: process.platform,
        isTTY: Boolean(process.stdout.isTTY),
        term: process.env.TERM ?? null,
        colorTerm: process.env.COLORTERM ?? null,
      },
      applied: applyResult,
    }

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2))
      return
    }

    UI.println(UI.Style.TEXT_HIGHLIGHT + "Terminal Setup" + UI.Style.TEXT_NORMAL)
    UI.empty()
    UI.println(`Shell:      ${shell}`)
    UI.println(`Profile:    ${profilePath}`)
    UI.println(`TTY:        ${payload.terminal.isTTY ? "yes" : "no"}`)
    UI.println(`TERM:       ${payload.terminal.term ?? "(unset)"}`)
    UI.println(`COLORTERM:  ${payload.terminal.colorTerm ?? "(unset)"}`)
    UI.empty()

    if (args.apply) {
      if (applyResult?.updated) {
        UI.println(UI.Style.TEXT_SUCCESS + "✓ Setup snippet appended to profile." + UI.Style.TEXT_NORMAL)
      } else {
        UI.println(UI.Style.TEXT_DIM + "Setup snippet already present in profile." + UI.Style.TEXT_NORMAL)
      }
      UI.println(UI.Style.TEXT_DIM + "Restart your terminal to load changes." + UI.Style.TEXT_NORMAL)
      return
    }

    UI.println(UI.Style.TEXT_INFO + "Suggested setup snippet:" + UI.Style.TEXT_NORMAL)
    UI.println(UI.Style.TEXT_DIM + snippet + UI.Style.TEXT_NORMAL)
    UI.empty()
    UI.println(UI.Style.TEXT_DIM + "Use --apply to append this snippet to your shell profile automatically." + UI.Style.TEXT_NORMAL)
  },
})

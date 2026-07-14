import z from "zod"
import { spawn } from "child_process"
import { Tool } from "./tool"
import path from "path"
import DESCRIPTION from "./powershell.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { Truncate } from "./truncation"
import { Flag } from "@/flag/flag.ts"
import { Shell } from "@/shell/shell"
import { Plugin } from "@/plugin"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = Flag.PAKALON_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000

export const log = Log.create({ service: "powershell-tool" })

// PowerShell read-only commands (auto-approved)
const READ_ONLY_CMDLETS = new Set([
  "get-childitem",
  "get-content",
  "get-item",
  "test-path",
  "get-process",
  "get-service",
  "get-location",
  "get-acl",
  "get-filehash",
  "select-string",
  "where-object",
  "format-table",
  "format-list",
  "format-wide",
  "format-hex",
  "measure-object",
  "select-object",
  "sort-object",
  "group-object",
  "write-output",
  "write-host",
  "get-date",
  "get-command",
  "get-help",
  "get-alias",
  "get-variable",
  "get-psdrive",
  "resolve-path",
  "split-path",
  "join-path",
  "test-connection",
  "get-culture",
  "get-uiculture",
  "get-random",
  "get-unique",
  "compare-object",
  "tee-object",
  "out-string",
  "out-null",
  "get-clipboard",
  "get-module",
  "get-installedmodule",
  "get-executionpolicy",
  "get-host",
  "get-history",
  "get-typedata",
  "get-formatdata",
])

// PowerShell aliases mapping to read-only cmdlets
const READ_ONLY_ALIASES: Record<string, string> = {
  "ls": "get-childitem",
  "dir": "get-childitem",
  "gci": "get-childitem",
  "cat": "get-content",
  "gc": "get-content",
  "type": "get-content",
  "gi": "get-item",
  "pwd": "get-location",
  "gl": "get-location",
  "ps": "get-process",
  "gps": "get-process",
  "gsv": "get-service",
  "sls": "select-string",
  "where": "where-object",
  "?": "where-object",
  "ft": "format-table",
  "fl": "format-list",
  "fw": "format-wide",
  "measure": "measure-object",
  "select": "select-object",
  "sort": "sort-object",
  "group": "group-object",
  "echo": "write-output",
  "write": "write-output",
  "gcm": "get-command",
  "gal": "get-alias",
  "gv": "get-variable",
  "gdr": "get-psdrive",
  "rvpa": "resolve-path",
  "compare": "compare-object",
  "diff": "compare-object",
  "tee": "tee-object",
  "gmo": "get-module",
  "gcb": "get-clipboard",
}

// Dangerous patterns that should not be auto-approved
const DANGEROUS_PATTERNS = [
  /\$\(/,          // Subexpression
  /@\{/,           // Splatting
  /\.\s*\(/,       // Method invocation
  /`/,             // Escape character (potential injection)
  /\bInvoke-Expression\b/i,
  /\biex\b/i,
  /\bInvoke-Command\b/i,
  /\bicm\b/i,
  /\bStart-Process\b/i,
  /\bsaps\b/i,
  /\bstart\b/i,
  /\bRemove-Item\b/i,
  /\bdel\b/i,
  /\brm\b/i,
  /\bri\b/i,
  /\brd\b/i,
  /\brmdir\b/i,
  /\berase\b/i,
  /\bSet-Content\b/i,
  /\bsc\b/i,
  /\bAdd-Content\b/i,
  /\bac\b/i,
  /\bOut-File\b/i,
  /\bNew-Item\b/i,
  /\bni\b/i,
  /\bmkdir\b/i,
  /\bmd\b/i,
  /\bMove-Item\b/i,
  /\bmv\b/i,
  /\bmi\b/i,
  /\bmove\b/i,
  /\bCopy-Item\b/i,
  /\bcp\b/i,
  /\bcpi\b/i,
  /\bcopy\b/i,
  /\bRename-Item\b/i,
  /\brni\b/i,
  /\bren\b/i,
  /\bStop-Process\b/i,
  /\bkill\b/i,
  /\bspps\b/i,
  /\bRestart-Service\b/i,
  /\bStop-Service\b/i,
  /\bStart-Service\b/i,
  /\bSet-ExecutionPolicy\b/i,
  /\bInstall-Module\b/i,
  /\bUninstall-Module\b/i,
  /\bUpdate-Module\b/i,
  /\bSet-ItemProperty\b/i,
  /\bClear-Content\b/i,
  /\bClear-Item\b/i,
  /\>\s*\w/,       // Output redirection
  /\|\s*Out-File\b/i,
]

/**
 * Check if a PowerShell command is read-only (safe for auto-approval)
 */
function isReadOnlyCommand(command: string): boolean {
  // Check for dangerous patterns first
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return false
    }
  }

  // Extract the first cmdlet/command
  const trimmed = command.trim()
  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase() || ""

  // Resolve alias to cmdlet
  const canonical = READ_ONLY_ALIASES[firstWord] || firstWord

  // Check if it's a read-only cmdlet
  return READ_ONLY_CMDLETS.has(canonical)
}

/**
 * Detect shell (pwsh or powershell.exe)
 */
async function getPowerShellPath(): Promise<string> {
  // Prefer PowerShell Core (pwsh) over Windows PowerShell
  const candidates = ["pwsh", "pwsh.exe", "powershell", "powershell.exe"]
  
  for (const candidate of candidates) {
    try {
      const { execSync } = await import("child_process")
      execSync(`${candidate} -Version`, { stdio: "ignore" })
      return candidate
    } catch {
      continue
    }
  }
  
  // Fall back to Windows PowerShell
  return "powershell.exe"
}

export const PowerShellTool = Tool.define("powershell", async () => {
  const shell = await getPowerShellPath()
  log.info("powershell tool using shell", { shell })

  return {
    description: DESCRIPTION.replaceAll("${directory}", Instance.directory)
      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
    parameters: z.object({
      command: z.string().describe("The PowerShell command to execute"),
      timeout: z.number().describe("Optional timeout in milliseconds").optional(),
      workdir: z
        .string()
        .describe(
          `The working directory to run the command in. Defaults to ${Instance.directory}. Use this instead of 'Set-Location' commands.`,
        )
        .optional(),
      run_in_background: z
        .boolean()
        .describe("Set to true to run this command in the background")
        .optional(),
      description: z
        .string()
        .describe(
          "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: Get-ChildItem\nOutput: Lists files in current directory\n\nInput: Get-Process\nOutput: Shows running processes\n\nInput: Get-Content file.txt\nOutput: Reads file contents",
        ),
    }),
    async execute(params, ctx) {
      const cwd = params.workdir || Instance.directory
      if (params.timeout !== undefined && params.timeout < 0) {
        throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
      }
      const timeout = params.timeout ?? DEFAULT_TIMEOUT

      const directories = new Set<string>()
      if (!Instance.containsPath(cwd)) directories.add(cwd)
      const patterns = new Set<string>()
      const always = new Set<string>()

      // Check if command is read-only (auto-approved)
      const isReadOnly = isReadOnlyCommand(params.command)

      // Request permission for non-read-only commands
      if (!isReadOnly) {
        patterns.add(params.command)
        always.add(params.command.split(/\s+/)[0] + " *")
      }

      if (directories.size > 0) {
        const globs = Array.from(directories).map((dir) => {
          return path.join(dir, "*")
        })
        await ctx.ask({
          permission: "external_directory",
          patterns: globs,
          always: globs,
          metadata: {},
        })
      }

      if (patterns.size > 0) {
        await ctx.ask({
          permission: "powershell",
          patterns: Array.from(patterns),
          always: Array.from(always),
          metadata: {},
        })
      }

      const shellEnv = await Plugin.trigger(
        "shell.env",
        { cwd, sessionID: ctx.sessionID, callID: ctx.callID },
        { env: {} },
      )

      // Build PowerShell command with proper escaping
      const psCommand = params.command.replace(/"/g, '\\"')
      const args = ["-NoProfile", "-NonInteractive", "-Command", params.command]

      const proc = spawn(shell, args, {
        cwd,
        env: {
          ...process.env,
          ...shellEnv.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      })

      let output = ""

      // Initialize metadata with empty output
      ctx.metadata({
        metadata: {
          output: "",
          description: params.description,
        },
      })

      const append = (chunk: Buffer) => {
        output += chunk.toString()
        ctx.metadata({
          metadata: {
            output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
            description: params.description,
          },
        })
      }

      proc.stdout?.on("data", append)
      proc.stderr?.on("data", append)

      let timedOut = false
      let aborted = false
      let exited = false

      const kill = () => {
        if (!exited) {
          try {
            proc.kill("SIGTERM")
          } catch {
            try {
              proc.kill("SIGKILL")
            } catch {
              // Process may have already exited
            }
          }
        }
      }

      if (ctx.abort.aborted) {
        aborted = true
        kill()
      }

      const abortHandler = () => {
        aborted = true
        kill()
      }

      ctx.abort.addEventListener("abort", abortHandler, { once: true })

      const timeoutTimer = setTimeout(() => {
        timedOut = true
        kill()
      }, timeout + 100)

      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeoutTimer)
          ctx.abort.removeEventListener("abort", abortHandler)
        }

        proc.once("exit", () => {
          exited = true
          cleanup()
          resolve()
        })

        proc.once("error", (error) => {
          exited = true
          cleanup()
          reject(error)
        })
      })

      const resultMetadata: string[] = []

      if (timedOut) {
        resultMetadata.push(`powershell tool terminated command after exceeding timeout ${timeout} ms`)
      }

      if (aborted) {
        resultMetadata.push("User aborted the command")
      }

      if (resultMetadata.length > 0) {
        output += "\n\n<powershell_metadata>\n" + resultMetadata.join("\n") + "\n</powershell_metadata>"
      }

      return {
        title: params.description,
        metadata: {
          output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
          exit: proc.exitCode,
          description: params.description,
        },
        output,
      }
    },
  }
})

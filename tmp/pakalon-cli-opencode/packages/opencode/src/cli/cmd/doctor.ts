import { cmd } from "./cmd"
import { UI } from "../ui"
import { spawn } from "child_process"
import fs from "fs/promises"
import path from "path"
import os from "os"

interface DoctorArgs {
  fix?: boolean
}

interface Check {
  name: string
  check: () => Promise<{ ok: boolean; message: string; fix?: () => Promise<void> }>
}

export const DoctorCommand = cmd({
  command: "doctor",
  describe: "Diagnose and fix common issues",
  builder: (yargs) =>
    yargs.option("fix", {
      type: "boolean",
      alias: "f",
      describe: "Attempt to fix issues automatically",
    }),
  async handler(args: DoctorArgs) {
    UI.println(UI.Style.TEXT_HIGHLIGHT + "🩺 Pakalon CLI Doctor")
    UI.println(UI.Style.TEXT_DIM + "Running diagnostics...")
    UI.empty()

    const checks: Check[] = [
      {
        name: "Node.js version",
        check: async () => {
          const version = process.version
          const major = parseInt(version.slice(1).split(".")[0])
          if (major >= 18) {
            return { ok: true, message: `Node.js ${version} (OK)` }
          }
          return { ok: false, message: `Node.js ${version} (requires >= 18)` }
        },
      },
      {
        name: "Git installation",
        check: async () => {
          const result = await runCommand("git", ["--version"])
          if (result.exitCode === 0) {
            return { ok: true, message: result.stdout.trim() }
          }
          return { ok: false, message: "Git not found" }
        },
      },
      {
        name: "Git repository",
        check: async () => {
          const result = await runCommand("git", ["rev-parse", "--git-dir"])
          if (result.exitCode === 0) {
            return { ok: true, message: "In a git repository" }
          }
          return { 
            ok: false, 
            message: "Not a git repository",
            fix: async () => {
              await runCommand("git", ["init"])
              UI.println(UI.Style.TEXT_SUCCESS + "  Initialized git repository")
            }
          }
        },
      },
      {
        name: "Config directory",
        check: async () => {
          const configDir = path.join(os.homedir(), ".config", "pakalon")
          try {
            await fs.access(configDir)
            return { ok: true, message: `Config directory exists: ${configDir}` }
          } catch {
            return { 
              ok: false, 
              message: `Config directory missing: ${configDir}`,
              fix: async () => {
                await fs.mkdir(configDir, { recursive: true })
                UI.println(UI.Style.TEXT_SUCCESS + "  Created config directory")
              }
            }
          }
        },
      },
      {
        name: ".pakalon directory",
        check: async () => {
          const pakalonDir = path.join(process.cwd(), ".pakalon")
          try {
            await fs.access(pakalonDir)
            return { ok: true, message: ".pakalon directory exists" }
          } catch {
            return { 
              ok: false, 
              message: ".pakalon directory missing (run /init to create)",
            }
          }
        },
      },
      {
        name: "Network connectivity",
        check: async () => {
          try {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 5000)
            await fetch("https://api.anthropic.com", { 
              method: "HEAD",
              signal: controller.signal 
            })
            clearTimeout(timeout)
            return { ok: true, message: "Can reach API servers" }
          } catch {
            return { ok: false, message: "Cannot reach API servers" }
          }
        },
      },
      {
        name: "Environment variables",
        check: async () => {
          const keys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "PAKALON_API_KEY"]
          const found = keys.filter(k => process.env[k])
          if (found.length > 0) {
            return { ok: true, message: `Found: ${found.join(", ")}` }
          }
          return { ok: false, message: "No API keys found in environment" }
        },
      },
      {
        name: "Disk space",
        check: async () => {
          const homeDir = os.homedir()
          try {
            // Write a small test file
            const testFile = path.join(homeDir, ".pakalon-doctor-test")
            await fs.writeFile(testFile, "test")
            await fs.unlink(testFile)
            return { ok: true, message: "Disk is writable" }
          } catch {
            return { ok: false, message: "Disk write failed" }
          }
        },
      },
    ]

    let passCount = 0
    let failCount = 0
    const fixes: (() => Promise<void>)[] = []

    for (const check of checks) {
      const result = await check.check()
      
      if (result.ok) {
        UI.println(`${UI.Style.TEXT_SUCCESS}✓${UI.Style.RESET} ${check.name}: ${result.message}`)
        passCount++
      } else {
        UI.println(`${UI.Style.TEXT_ERROR}✗${UI.Style.RESET} ${check.name}: ${result.message}`)
        failCount++
        if (result.fix) {
          fixes.push(result.fix)
        }
      }
    }

    UI.empty()
    UI.println(UI.Style.TEXT_HIGHLIGHT + "Summary:")
    UI.println(`  ${UI.Style.TEXT_SUCCESS}${passCount} passed${UI.Style.RESET}, ${UI.Style.TEXT_ERROR}${failCount} failed${UI.Style.RESET}`)

    if (fixes.length > 0 && args.fix) {
      UI.empty()
      UI.println(UI.Style.TEXT_INFO + "Attempting fixes...")
      for (const fix of fixes) {
        await fix()
      }
    } else if (fixes.length > 0) {
      UI.empty()
      UI.println(UI.Style.TEXT_DIM + `${fixes.length} issue(s) can be auto-fixed. Run with --fix to apply.`)
    }

    if (failCount === 0) {
      UI.empty()
      UI.println(UI.Style.TEXT_SUCCESS + "✨ All checks passed!")
    }
  },
})

async function runCommand(command: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
    
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

    proc.on("error", () => {
      resolve({ exitCode: 1, stdout: "", stderr: "Command not found" })
    })
  })
}
